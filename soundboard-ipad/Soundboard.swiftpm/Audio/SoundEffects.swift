import AVFoundation
import Foundation

/// Sound effects a scene kit can put on the sounds it plays. The Mac and
/// Android build the same ones with Web Audio in src/renderer/fx.js; keep the
/// two in step (names, hints, icons and how they sound).
enum SoundEffect: String, CaseIterable, Identifiable {
    case distant, echo, radio, underwater

    var id: String { rawValue }

    var name: String {
        switch self {
        case .distant: return "Distant room"
        case .echo: return "Empty echo"
        case .radio: return "Old radio"
        case .underwater: return "Underwater"
        }
    }

    var hint: String {
        switch self {
        case .distant: return "Muffled, through a wall"
        case .echo: return "A big empty hall"
        case .radio: return "Thin and crackly"
        case .underwater: return "Deep and murky"
        }
    }

    /// A line icon (Icons.swift).
    var icon: String {
        switch self {
        case .distant: return "gate"
        case .echo: return "cave"
        case .radio: return "speaker"
        case .underwater: return "wave"
        }
    }

    /// Seconds it keeps sounding after the sound stops (its echo dying away).
    var tail: TimeInterval {
        switch self {
        case .distant: return 1.5
        case .echo: return 5
        case .radio: return 0.2
        case .underwater: return 2
        }
    }

    /// The effect's audio units, in the order the sound goes through them.
    func makeUnits() -> [AVAudioUnit] {
        switch self {
        case .distant:
            // Through a wall: the highs gone, a little of the room left.
            let eq = AVAudioUnitEQ(numberOfBands: 3)
            Self.band(eq, 0, .highPass, 90)
            Self.band(eq, 1, .lowPass, 420)
            Self.band(eq, 2, .lowPass, 900)
            eq.globalGain = -2.5
            let room = AVAudioUnitReverb()
            room.loadFactoryPreset(.mediumRoom)
            room.wetDryMix = 35
            return [eq, room]
        case .echo:
            // A big empty hall: repeats that fade, and a long reverb.
            let delay = AVAudioUnitDelay()
            delay.delayTime = 0.38
            delay.feedback = 48
            delay.lowPassCutoff = 2800
            delay.wetDryMix = 40
            let hall = AVAudioUnitReverb()
            hall.loadFactoryPreset(.largeHall2)
            hall.wetDryMix = 35
            return [delay, hall]
        case .radio:
            // A thin band of sound, a midrange bump and a little crunch.
            let eq = AVAudioUnitEQ(numberOfBands: 3)
            Self.band(eq, 0, .highPass, 480)
            Self.band(eq, 1, .lowPass, 3200)
            Self.band(eq, 2, .parametric, 1500, gain: 6, bandwidth: 1)
            eq.globalGain = -4
            let crunch = AVAudioUnitDistortion()
            crunch.loadFactoryPreset(.speechRadioTower)
            crunch.wetDryMix = 40
            return [eq, crunch]
        case .underwater:
            // Deep and murky: a low, resonant muffle in a wet space.
            let eq = AVAudioUnitEQ(numberOfBands: 2)
            Self.band(eq, 0, .resonantLowPass, 340)
            Self.band(eq, 1, .lowPass, 700)
            eq.globalGain = -1.5
            let space = AVAudioUnitReverb()
            space.loadFactoryPreset(.mediumChamber)
            space.wetDryMix = 50
            return [eq, space]
        }
    }

    private static func band(_ eq: AVAudioUnitEQ, _ index: Int, _ type: AVAudioUnitEQFilterType, _ frequency: Float,
                             gain: Float = 0, bandwidth: Float = 0.5) {
        let band = eq.bands[index]
        band.filterType = type
        band.frequency = frequency
        band.gain = gain
        band.bandwidth = bandwidth
        band.bypass = false
    }

    /// The same effect in the full list (bash clips, Live Session plays).
    var voice: VoiceEffect { VoiceEffect(rawValue: rawValue) ?? .radio }
}

/// What a playing copy of a sound needs from its player: AVAudioPlayer, or
/// FxPlayer for a sound played through an effect.
protocol VoicePlayer: AnyObject {
    var volume: Float { get set }
    var currentTime: TimeInterval { get set }
    var duration: TimeInterval { get }
    var isPlaying: Bool { get }
    var numberOfLoops: Int { get set }
    var deviceCurrentTime: TimeInterval { get }
    @discardableResult func prepareToPlay() -> Bool
    @discardableResult func play() -> Bool
    @discardableResult func play(atTime time: TimeInterval) -> Bool
    func stop()
    func setVolume(_ volume: Float, fadeDuration duration: TimeInterval)
}

extension AVAudioPlayer: VoicePlayer {}

/// Plays a file through a sound effect, faster or slower, with the same
/// controls as AVAudioPlayer (volume and fades, seeking, looping, starting at
/// a time). currentTime and duration are in the file's own time; it plays
/// `rate` seconds of the file each second.
final class FxPlayer: VoicePlayer {
    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()
    private let output = AVAudioMixerNode()
    private let file: AVAudioFile
    private let sampleRate: Double
    private let tail: TimeInterval
    /// An effect's own sound (Static's hiss), heard only while the file plays.
    private var sideGate: AVAudioMixerNode?
    /// Warble's pitch, moved while it plays.
    private var wobble: AVAudioUnitTimePitch?
    private var wobbleTimer: Timer?
    private var wobbleStart = Date()
    let rate: Double
    /// Where the scheduled part of the file starts, in frames.
    private var segmentStart: AVAudioFramePosition = 0
    /// Where play() starts from (moved by setting currentTime).
    private var resumeFrame: AVAudioFramePosition = 0
    private var playing = false
    /// Bumped whenever the schedule changes, so old "finished" calls are ignored.
    private var generation = 0
    private var fadeTimer: Timer?

    var numberOfLoops = 0
    let duration: TimeInterval

    /// A scene kit's effect.
    convenience init(contentsOf url: URL, effect: SoundEffect) throws {
        try self.init(contentsOf: url, voice: effect.voice)
    }

    /// voice: the effect, or nil for none. amount: how much of it you hear (the
    /// rest is the plain sound). speed: faster and higher, or slower and deeper.
    init(contentsOf url: URL, voice: VoiceEffect?, amount: Double = 1, speed: Double = 1) throws {
        file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        sampleRate = format.sampleRate
        duration = sampleRate > 0 ? Double(file.length) / sampleRate : 0
        let chain = voice?.makeChain() ?? VoiceEffect.Chain()
        tail = chain.tail
        rate = max(0.1, speed * chain.rate)
        wobble = chain.wobble
        engine.attach(node)
        engine.attach(output)

        // Speed goes first, so the plain and the effected sound stay together.
        var source: AVAudioNode = node
        if abs(rate - 1) > 0.001 {
            let varispeed = AVAudioUnitVarispeed()
            varispeed.rate = Float(rate)
            engine.attach(varispeed)
            engine.connect(node, to: varispeed, format: format)
            source = varispeed
        }
        guard voice != nil, !chain.units.isEmpty else {
            engine.connect(source, to: output, format: format)
            engine.connect(output, to: engine.mainMixerNode, format: nil)
            return
        }

        // The sound splits: through the effect (wet) and as it is (dry).
        let mix = Float(min(1, max(0, amount)))
        let wet = AVAudioMixerNode()
        let dry = AVAudioMixerNode()
        engine.attach(wet)
        engine.attach(dry)
        wet.outputVolume = mix
        dry.outputVolume = 1 - mix
        for unit in chain.units { engine.attach(unit) }
        engine.connect(source, to: [AVAudioConnectionPoint(node: chain.units[0], bus: 0), AVAudioConnectionPoint(node: dry, bus: 0)],
                       fromBus: 0, format: format)
        for index in 1..<chain.units.count {
            engine.connect(chain.units[index - 1], to: chain.units[index], format: format)
        }
        engine.connect(chain.units[chain.units.count - 1], to: wet, fromBus: 0, toBus: 0, format: format)
        if !chain.side.isEmpty {
            let gate = AVAudioMixerNode()
            gate.outputVolume = 0
            engine.attach(gate)
            for node in chain.side { engine.attach(node) }
            for index in 1..<chain.side.count {
                engine.connect(chain.side[index - 1], to: chain.side[index], format: format)
            }
            engine.connect(chain.side[chain.side.count - 1], to: gate, format: format)
            engine.connect(gate, to: wet, fromBus: 0, toBus: wet.nextAvailableInputBus, format: format)
            sideGate = gate
        }
        engine.connect(wet, to: output, fromBus: 0, toBus: 0, format: format)
        engine.connect(dry, to: output, fromBus: 0, toBus: output.nextAvailableInputBus, format: format)
        engine.connect(output, to: engine.mainMixerNode, format: nil)
    }

    var volume: Float {
        get { output.outputVolume }
        set {
            fadeTimer?.invalidate()
            fadeTimer = nil
            output.outputVolume = newValue
        }
    }

    var isPlaying: Bool { playing }

    var deviceCurrentTime: TimeInterval { AVAudioTime.seconds(forHostTime: mach_absolute_time()) }

    var currentTime: TimeInterval {
        get {
            guard playing, let renderTime = node.lastRenderTime,
                  let time = node.playerTime(forNodeTime: renderTime) else {
                return sampleRate > 0 ? Double(resumeFrame) / sampleRate : 0
            }
            let frame = segmentStart + max(0, time.sampleTime)
            return min(duration, Double(frame) / sampleRate)
        }
        set {
            resumeFrame = AVAudioFramePosition(max(0, newValue) * sampleRate)
            if playing {
                if schedule(from: resumeFrame) { node.play() } else { finished() }
            }
        }
    }

    @discardableResult
    func prepareToPlay() -> Bool {
        engine.prepare()
        return true
    }

    @discardableResult
    func play() -> Bool { start(at: nil) }

    /// Starts at a time on deviceCurrentTime's clock.
    @discardableResult
    func play(atTime time: TimeInterval) -> Bool {
        let delay = max(0, time - deviceCurrentTime)
        return start(at: AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: delay)))
    }

    func stop() {
        generation += 1
        fadeTimer?.invalidate()
        fadeTimer = nil
        node.stop()
        sideGate?.outputVolume = 0
        playing = false
        resumeFrame = 0
        windDown()
    }

    func setVolume(_ target: Float, fadeDuration: TimeInterval) {
        fadeTimer?.invalidate()
        fadeTimer = nil
        guard fadeDuration > 0 else {
            output.outputVolume = target
            return
        }
        let from = output.outputVolume
        let started = Date()
        fadeTimer = Timer.scheduledTimer(withTimeInterval: 0.04, repeats: true) { [weak self] timer in
            guard let self else {
                timer.invalidate()
                return
            }
            let progress = Float(min(1, Date().timeIntervalSince(started) / fadeDuration))
            self.output.outputVolume = from + (target - from) * progress
            if progress >= 1 {
                timer.invalidate()
                self.fadeTimer = nil
            }
        }
    }

    private func start(at when: AVAudioTime?) -> Bool {
        if !engine.isRunning {
            do { try engine.start() } catch { return false }
        }
        guard schedule(from: resumeFrame) else { return false }
        node.play(at: when)
        playing = true
        let delay = when.map { max(0, AVAudioTime.seconds(forHostTime: $0.hostTime) - deviceCurrentTime) } ?? 0
        if let gate = sideGate {
            let current = generation
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                if let self, self.playing, self.generation == current { gate.outputVolume = 1 }
            }
        }
        if let wobble, wobbleTimer == nil {
            wobbleStart = Date().addingTimeInterval(delay)
            wobbleTimer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { [weak self] _ in
                guard let self else { return }
                wobble.pitch = VoiceEffect.wobble(at: max(0, Date().timeIntervalSince(self.wobbleStart)))
            }
        }
        return true
    }

    /// Schedules the file from `frame` to its end. False if there's nothing left.
    private func schedule(from frame: AVAudioFramePosition) -> Bool {
        generation += 1
        let current = generation
        node.stop()
        let start = min(max(0, frame), file.length)
        segmentStart = start
        let count = AVAudioFrameCount(file.length - start)
        guard count > 0 else { return false }
        node.scheduleSegment(file, startingFrame: start, frameCount: count, at: nil,
                             completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async { self?.segmentFinished(current) }
        }
        return true
    }

    private func segmentFinished(_ which: Int) {
        guard which == generation, playing else { return }
        if numberOfLoops != 0 {
            if numberOfLoops > 0 { numberOfLoops -= 1 }
            resumeFrame = 0
            if schedule(from: 0) {
                node.play()
                return
            }
        }
        finished()
    }

    private func finished() {
        playing = false
        resumeFrame = 0
        sideGate?.outputVolume = 0
        windDown()
    }

    /// Lets the effect's echo die away, then stops the engine. The player is
    /// kept alive until then, even if nothing else holds it.
    private func windDown() {
        DispatchQueue.main.asyncAfter(deadline: .now() + tail + 0.3) { [self] in
            if !self.playing {
                self.engine.stop()
                self.wobbleTimer?.invalidate()
                self.wobbleTimer = nil
            }
        }
    }
}

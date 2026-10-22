import AVFoundation
import AudioToolbox

/// Voice effects for a recording (baked into the saved file) and for bash
/// clips (played live, at any intensity). The Mac and Android have the same
/// list in src/renderer/fx.js (Fx.VOICE); keep the names, order and sound in step.
enum VoiceEffect: String, CaseIterable, Identifiable {
    case radio, crackle = "static", distorted, robot, ghost, demon, distant, echo, underwater
    case cave, megaphone, warble, fairy

    var id: String { rawValue }

    var name: String {
        switch self {
        case .radio: return "Radio"
        case .crackle: return "Static"
        case .distorted: return "Distorted"
        case .robot: return "Robot"
        case .ghost: return "Ghost"
        case .demon: return "Demon"
        case .distant: return "Distant room"
        case .echo: return "Empty echo"
        case .underwater: return "Underwater"
        case .cave: return "Cave"
        case .megaphone: return "Megaphone"
        case .warble: return "Warble"
        case .fairy: return "Fairy"
        }
    }

    var hint: String {
        switch self {
        case .radio: return "Thin and crackly"
        case .crackle: return "A hissing, crackling line"
        case .distorted: return "Blown out and harsh"
        case .robot: return "Metallic and buzzing"
        case .ghost: return "Airy, wavering, far off"
        case .demon: return "Deep, slow and growling"
        case .distant: return "Muffled, through a wall"
        case .echo: return "A big empty hall"
        case .underwater: return "Deep and murky"
        case .cave: return "Dark, dripping echoes"
        case .megaphone: return "Loud, thin and crunchy"
        case .warble: return "Wobbling pitch and volume"
        case .fairy: return "Faster, higher and sparkling"
        }
    }

    /// How fast the sound plays through it (Demon is slower and deeper, Fairy
    /// faster and higher). Whoever plays the chain applies it, to the dry
    /// sound as well, so the two stay together.
    var rate: Double {
        switch self {
        case .demon: return 0.72
        case .fairy: return 1.35
        default: return 1
        }
    }

    /// Seconds it rings on after the sound ends.
    var tail: Double {
        switch self {
        case .radio, .distorted, .megaphone, .warble: return 0.1
        case .crackle, .robot: return 0.3
        case .demon, .distant: return 1.5
        case .underwater: return 2
        case .fairy: return 3
        case .ghost, .cave: return 4
        case .echo: return 5
        }
    }

    /// Warble's pitch wobble, in cents, `seconds` into the sound.
    static func wobble(at seconds: Double) -> Float {
        Float(200 * sin(2 * Double.pi * 5.5 * seconds))
    }

    /// The voice's path (in order), a separate sound added beside it (Static's
    /// hiss), how long it rings on, how fast the voice plays (see `rate`), and
    /// a pitch unit to wobble (Warble) with `wobble(at:)` as it plays.
    struct Chain {
        var units: [AVAudioNode] = []
        var side: [AVAudioNode] = []
        var tail: Double = 0
        var rate: Double = 1
        var wobble: AVAudioUnitTimePitch? = nil
    }

    func makeChain() -> Chain {
        switch self {
        case .radio:
            return Chain(units: SoundEffect.radio.makeUnits(), tail: tail)
        case .distant:
            return Chain(units: SoundEffect.distant.makeUnits(), tail: tail)
        case .echo:
            return Chain(units: SoundEffect.echo.makeUnits(), tail: tail)
        case .underwater:
            return Chain(units: SoundEffect.underwater.makeUnits(), tail: tail)
        case .crackle:
            // A bad line: a narrow band of voice, a little crunch, hiss and crackle.
            let eq = Self.eq([(.highPass, 350, 0), (.lowPass, 3500, 0)])
            let crunch = AVAudioUnitDistortion()
            crunch.loadFactoryPreset(.speechRadioTower)
            crunch.wetDryMix = 30
            let noise = AVAudioSourceNode { _, _, frameCount, audioBufferList -> OSStatus in
                for buffer in UnsafeMutableAudioBufferListPointer(audioBufferList) {
                    let samples = UnsafeMutableBufferPointer<Float>(buffer)
                    for i in 0..<min(Int(frameCount), samples.count) {
                        let click: Float = Float.random(in: 0...1) < 0.0006 ? Float.random(in: -1...1) : 0
                        samples[i] = Float.random(in: -1...1) * 0.5 + click
                    }
                }
                return noErr
            }
            let band = AVAudioUnitEQ(numberOfBands: 1)
            Self.band(band, 0, .bandPass, 2600, bandwidth: 1.5)
            band.globalGain = -21 // about 0.09
            return Chain(units: [eq, crunch], side: [noise, band], tail: tail)
        case .distorted:
            // Blown out: driven hard into clipping, then tamed.
            let high = Self.eq([(.highPass, 120, 0)])
            let drive = AVAudioUnitDistortion()
            drive.loadFactoryPreset(.multiDistortedCubed)
            drive.wetDryMix = 100
            let tame = Self.eq([(.lowPass, 4500, 0)])
            tame.globalGain = -8
            return Chain(units: [high, drive, tame], tail: tail)
        case .robot:
            // Ring modulation (the voice times a 55 Hz tone) and a short metallic comb.
            let ring = AVAudioUnitDistortion()
            let au = ring.audioUnit
            let params: [(Int, Float)] = [
                (Int(kDistortionParam_DelayMix), 0), (Int(kDistortionParam_DecimationMix), 0),
                (Int(kDistortionParam_PolynomialMix), 0), (Int(kDistortionParam_RingModFreq1), 55),
                (Int(kDistortionParam_RingModFreq2), 55), (Int(kDistortionParam_RingModBalance), 0),
                (Int(kDistortionParam_RingModMix), 100), (Int(kDistortionParam_SoftClipGain), 0),
            ]
            for (param, value) in params {
                AudioUnitSetParameter(au, AudioUnitParameterID(param), kAudioUnitScope_Global, 0, value, 0)
            }
            ring.wetDryMix = 85
            let comb = AVAudioUnitDelay()
            comb.delayTime = 0.008
            comb.feedback = 60
            comb.lowPassCutoff = 8000
            comb.wetDryMix = 35
            return Chain(units: [ring, comb], tail: tail)
        case .ghost:
            // Airy and wavering: thinned, doubled a moment later, deep in a long reverb.
            let thin = Self.eq([(.highPass, 260, 0), (.lowPass, 6000, 0)])
            let shimmer = AVAudioUnitDelay()
            shimmer.delayTime = 0.03
            shimmer.feedback = 50
            shimmer.wetDryMix = 30
            let late = AVAudioUnitDelay()
            late.delayTime = 0.14
            late.feedback = 20
            late.wetDryMix = 30
            let hall = AVAudioUnitReverb()
            hall.loadFactoryPreset(.cathedral)
            hall.wetDryMix = 60
            return Chain(units: [thin, shimmer, late, hall], tail: tail)
        case .demon:
            // Played slower (so deeper: `rate`), growled and darkened, in a stone room.
            let dark = Self.eq([(.lowPass, 2400, 0)])
            let growl = AVAudioUnitDistortion()
            growl.loadFactoryPreset(.multiDistortedSquared)
            growl.wetDryMix = 35
            let room = AVAudioUnitReverb()
            room.loadFactoryPreset(.mediumChamber)
            room.wetDryMix = 25
            return Chain(units: [dark, growl, room], tail: tail, rate: rate)
        case .cave:
            // Dark and deep underground: dripping echoes in a huge stone space.
            let dark = Self.eq([(.highPass, 70, 0), (.lowPass, 2800, 0)])
            let drip = AVAudioUnitDelay()
            drip.delayTime = 0.27
            drip.feedback = 35
            drip.lowPassCutoff = 1800
            drip.wetDryMix = 40
            let cavern = AVAudioUnitReverb()
            cavern.loadFactoryPreset(.cathedral)
            cavern.wetDryMix = 55
            return Chain(units: [dark, drip, cavern], tail: tail)
        case .megaphone:
            // A horn: only the middle, pushed hard and crunching.
            let horn = Self.eq([(.highPass, 700, 0), (.lowPass, 2600, 0), (.parametric, 1700, 10)])
            horn.globalGain = -6
            let crunch = AVAudioUnitDistortion()
            crunch.loadFactoryPreset(.multiDistortedCubed)
            crunch.wetDryMix = 60
            return Chain(units: [horn, crunch], tail: tail)
        case .warble:
            // A worn tape: the pitch wobbles (driven by whoever plays it) and the level throbs.
            let pitch = AVAudioUnitTimePitch()
            let throb = AVAudioUnitDistortion()
            let au = throb.audioUnit
            let params: [(Int, Float)] = [
                (Int(kDistortionParam_DelayMix), 0), (Int(kDistortionParam_DecimationMix), 0),
                (Int(kDistortionParam_PolynomialMix), 0), (Int(kDistortionParam_RingModFreq1), 3.5),
                (Int(kDistortionParam_RingModFreq2), 3.5), (Int(kDistortionParam_RingModBalance), 0),
                (Int(kDistortionParam_RingModMix), 100), (Int(kDistortionParam_SoftClipGain), 0),
            ]
            for (param, value) in params {
                AudioUnitSetParameter(au, AudioUnitParameterID(param), kAudioUnitScope_Global, 0, value, 0)
            }
            throb.wetDryMix = 35
            return Chain(units: [pitch, throb], tail: tail, wobble: pitch)
        case .fairy:
            // Faster and higher (`rate`), brightened, with sparkling repeats in a hall.
            let bright = Self.eq([(.highPass, 200, 0), (.highShelf, 3000, 6)])
            let sparkle = AVAudioUnitDelay()
            sparkle.delayTime = 0.09
            sparkle.feedback = 45
            sparkle.lowPassCutoff = 15000
            sparkle.wetDryMix = 30
            let air = AVAudioUnitReverb()
            air.loadFactoryPreset(.mediumHall)
            air.wetDryMix = 35
            return Chain(units: [bright, sparkle, air], tail: tail, rate: rate)
        }
    }

    private static func eq(_ bands: [(AVAudioUnitEQFilterType, Float, Float)]) -> AVAudioUnitEQ {
        let eq = AVAudioUnitEQ(numberOfBands: bands.count)
        for (index, b) in bands.enumerated() { band(eq, index, b.0, b.1, gain: b.2) }
        return eq
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
}

/// Renders an edited recording (RecorderView): the voice through its effect,
/// with library sounds played along, into a mono WAV. The same as the Mac's
/// src/renderer/voice-edit.js.
enum VoiceEdit {
    static let maxLayers = 4
    static let maxSeconds = 660.0

    /// A library sound played along with the recording.
    struct Layer: Identifiable, Equatable {
        let id = UUID()
        let soundId: UUID
        let name: String
        let url: URL
        var volume = 0.6
        /// Seconds into the recording it starts.
        var start = 0.0
    }

    enum EditError: LocalizedError {
        case failed
        var errorDescription: String? { "Couldn’t apply the edit." }
    }

    static func render(voice: URL, effect: VoiceEffect?, layers: [Layer], to out: URL) throws {
        let voiceFile = try AVAudioFile(forReading: voice)
        let sampleRate = voiceFile.processingFormat.sampleRate
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else { throw EditError.failed }
        let engine = AVAudioEngine()
        try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)

        // Everything meets in a mixer, then a peak limiter, so the mix never clips.
        let bus = AVAudioMixerNode()
        let limiter = AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
            componentType: kAudioUnitType_Effect, componentSubType: kAudioUnitSubType_PeakLimiter,
            componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0))
        engine.attach(bus)
        engine.attach(limiter)
        engine.connect(bus, to: limiter, format: format)
        engine.connect(limiter, to: engine.mainMixerNode, format: format)

        let chain = effect?.makeChain() ?? VoiceEffect.Chain()
        let voicePlayer = AVAudioPlayerNode()
        engine.attach(voicePlayer)
        var last: AVAudioNode = voicePlayer
        if chain.rate != 1 {
            let speed = AVAudioUnitVarispeed()
            speed.rate = Float(chain.rate)
            engine.attach(speed)
            engine.connect(voicePlayer, to: speed, format: voiceFile.processingFormat)
            last = speed
        }
        for unit in chain.units {
            engine.attach(unit)
            engine.connect(last, to: unit, format: voiceFile.processingFormat)
            last = unit
        }
        engine.connect(last, to: bus, format: voiceFile.processingFormat)
        var sideLast: AVAudioNode?
        for node in chain.side {
            engine.attach(node)
            if let sideLast { engine.connect(sideLast, to: node, format: format) }
            sideLast = node
        }
        if let sideLast { engine.connect(sideLast, to: bus, format: format) }

        var seconds = Double(voiceFile.length) / sampleRate / chain.rate + chain.tail
        var players: [(AVAudioPlayerNode, AVAudioFile, Double)] = []
        for layer in layers.prefix(maxLayers) {
            guard let file = try? AVAudioFile(forReading: layer.url) else { continue }
            let player = AVAudioPlayerNode()
            engine.attach(player)
            engine.connect(player, to: bus, format: file.processingFormat)
            player.volume = Float(min(1, max(0, layer.volume)))
            let start = min(maxSeconds, max(0, layer.start))
            players.append((player, file, start))
            seconds = max(seconds, start + Double(file.length) / file.processingFormat.sampleRate)
        }
        seconds = min(maxSeconds, seconds)

        try engine.start()
        defer { engine.stop() }
        voicePlayer.scheduleFile(voiceFile, at: nil)
        voicePlayer.play()
        for (player, file, start) in players {
            player.scheduleFile(file, at: AVAudioTime(sampleTime: AVAudioFramePosition(start * sampleRate), atRate: sampleRate))
            player.play()
        }

        try? FileManager.default.removeItem(at: out)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM), AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
        ]
        let output = try AVAudioFile(forWriting: out, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: engine.manualRenderingMaximumFrameCount) else {
            throw EditError.failed
        }
        let total = AVAudioFramePosition(seconds * sampleRate)
        var stalls = 0
        // Warble's wobble moves in small steps, so it's rendered a little at a time.
        let step = Int64(chain.wobble == nil ? buffer.frameCapacity : 256)
        while engine.manualRenderingSampleTime < total {
            chain.wobble?.pitch = VoiceEffect.wobble(at: Double(engine.manualRenderingSampleTime) / sampleRate)
            let frames = AVAudioFrameCount(min(step, total - engine.manualRenderingSampleTime))
            switch try engine.renderOffline(frames, to: buffer) {
            case .success:
                try output.write(from: buffer)
                stalls = 0
            case .insufficientDataFromInputNode, .cannotDoInCurrentContext:
                stalls += 1
                if stalls > 100 { throw EditError.failed }
            case .error:
                throw EditError.failed
            @unknown default:
                throw EditError.failed
            }
        }
    }
}

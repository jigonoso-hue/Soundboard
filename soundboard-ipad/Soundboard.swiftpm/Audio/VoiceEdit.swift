import AVFoundation
import AudioToolbox

/// Voice effects for a recording, baked into the saved file. The Mac and
/// Android have the same list in src/renderer/fx.js (Fx.VOICE); keep the
/// names, order and sound in step.
enum VoiceEffect: String, CaseIterable, Identifiable {
    case radio, crackle = "static", distorted, robot, ghost, demon, distant, echo, underwater

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
        }
    }

    /// The voice's path (in order), a separate sound added beside it (Static's
    /// hiss), how long it rings on, and how fast the voice plays (Demon is
    /// slower, so deeper).
    struct Chain {
        var units: [AVAudioNode] = []
        var side: [AVAudioNode] = []
        var tail: Double = 0
        var rate: Double = 1
    }

    func makeChain() -> Chain {
        switch self {
        case .radio:
            return Chain(units: SoundEffect.radio.makeUnits(), tail: 0.1)
        case .distant:
            return Chain(units: SoundEffect.distant.makeUnits(), tail: 1.5)
        case .echo:
            return Chain(units: SoundEffect.echo.makeUnits(), tail: 5)
        case .underwater:
            return Chain(units: SoundEffect.underwater.makeUnits(), tail: 2)
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
            return Chain(units: [eq, crunch], side: [noise, band], tail: 0.3)
        case .distorted:
            // Blown out: driven hard into clipping, then tamed.
            let high = Self.eq([(.highPass, 120, 0)])
            let drive = AVAudioUnitDistortion()
            drive.loadFactoryPreset(.multiDistortedCubed)
            drive.wetDryMix = 100
            let tame = Self.eq([(.lowPass, 4500, 0)])
            tame.globalGain = -8
            return Chain(units: [high, drive, tame], tail: 0.1)
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
            return Chain(units: [ring, comb], tail: 0.3)
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
            return Chain(units: [thin, shimmer, late, hall], tail: 4)
        case .demon:
            // Played slower (so deeper), growled and darkened, in a stone room.
            let slow = AVAudioUnitVarispeed()
            slow.rate = 0.72
            let dark = Self.eq([(.lowPass, 2400, 0)])
            let growl = AVAudioUnitDistortion()
            growl.loadFactoryPreset(.multiDistortedSquared)
            growl.wetDryMix = 35
            let room = AVAudioUnitReverb()
            room.loadFactoryPreset(.mediumChamber)
            room.wetDryMix = 25
            return Chain(units: [slow, dark, growl, room], tail: 1.5, rate: 0.72)
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
        while engine.manualRenderingSampleTime < total {
            let frames = AVAudioFrameCount(min(Int64(buffer.frameCapacity), total - engine.manualRenderingSampleTime))
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

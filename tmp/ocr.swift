import Foundation
import Vision
import AppKit

let paths = CommandLine.arguments.dropFirst()
for p in paths {
    let url = URL(fileURLWithPath: p)
    guard let img = NSImage(contentsOf: url) else { print("FAIL \(p)"); continue }
    var rect = NSRect(origin: .zero, size: img.size)
    guard let cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { print("NOCG \(p)"); continue }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do {
        try handler.perform([req])
        print("FILE: \(p)")
        let obs = req.results ?? []
        for o in obs {
            if let t = o.topCandidates(1).first {
                print(t.string)
            }
        }
        print("---")
    } catch {
        print("ERR \(p): \(error)")
    }
}

// Reads QR codes from image files with macOS CoreImage, a decoder independent of src/qr.js.
// Prints one line per file: the path, a tab, and the decoded text (empty if none).
import CoreImage
import Foundation

let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
for path in CommandLine.arguments.dropFirst() {
    let image = CIImage(contentsOf: URL(fileURLWithPath: path))
    let text = image.flatMap { detector.features(in: $0).compactMap { ($0 as? CIQRCodeFeature)?.messageString }.first } ?? ""
    print("\(path)\t\(text)")
}

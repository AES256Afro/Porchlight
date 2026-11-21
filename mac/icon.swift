// Draws the app icon from mac/icon.png (the brand's full icon, 1024 pixels), and the smallest sizes from
// the mark drawn for them (cli/ui/favicon.svg), so 16 and 32 pixels are not the full artwork shrunk (R6V-5):
// icon.swift <icon.png> <out.iconset> [<small.svg>]
import AppKit

let args = CommandLine.arguments
guard args.count == 3 || args.count == 4, let mark = NSImage(contentsOfFile: args[1]) else {
	FileHandle.standardError.write("usage: icon <icon.png> <out.iconset> [<small.svg>]\n".data(using: .utf8)!)
	exit(1)
}
// Without it, or where this macOS cannot read it, every size comes from the full icon as before.
let small = args.count == 4 ? NSImage(contentsOfFile: args[3]) : nil
let out = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func render(_ px: Int) -> Data {
	let art = px <= 32 ? (small ?? mark) : mark
	let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
	                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
	                           bytesPerRow: 0, bitsPerPixel: 0)!
	NSGraphicsContext.saveGraphicsState()
	NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
	let s = CGFloat(px)
	let tile = NSRect(x: s * 0.1, y: s * 0.1, width: s * 0.8, height: s * 0.8)
	// The artwork fills the tile; the tile's rounded corners clip it.
	NSBezierPath(roundedRect: tile, xRadius: s * 0.18, yRadius: s * 0.18).addClip()
	NSGraphicsContext.current?.imageInterpolation = .high
	art.draw(in: tile)
	NSGraphicsContext.restoreGraphicsState()
	return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
	try render(size).write(to: out.appendingPathComponent("icon_\(size)x\(size).png"))
	try render(size * 2).write(to: out.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}

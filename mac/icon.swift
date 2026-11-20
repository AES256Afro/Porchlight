// Draws the app icon from mac/icon.png (the brand's full icon, 1024 pixels): icon.swift <icon.png> <out.iconset>
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let mark = NSImage(contentsOfFile: args[1]) else {
	FileHandle.standardError.write("usage: icon <icon.png> <out.iconset>\n".data(using: .utf8)!)
	exit(1)
}
let out = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func render(_ px: Int) -> Data {
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
	mark.draw(in: tile)
	NSGraphicsContext.restoreGraphicsState()
	return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
	try render(size).write(to: out.appendingPathComponent("icon_\(size)x\(size).png"))
	try render(size * 2).write(to: out.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}

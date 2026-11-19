// SecurityX for the Mac: a window around `securityx ui`.
//
// It starts the local web interface (through launch.sh, written by build.sh),
// waits for the link it prints, shows that page in its own window, and stops
// the interface when the window closes. It adds nothing to the interface's
// protections: the page is still served on 127.0.0.1 with a per-run key.

import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
	private var window: NSWindow!
	private var webView: WKWebView!
	private var status: NSTextField!
	private var server: Process?
	private var origin: URL?
	private var output = ""
	private var quitting = false
	private var savedTo: [ObjectIdentifier: URL] = [:]
	private let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".securityx/app.log")

	private var signalSources: [DispatchSourceSignal] = []

	func applicationDidFinishLaunching(_ notification: Notification) {
		// Stopped from outside (kill, logout): quit the normal way, so the server stops too.
		for sig in [SIGTERM, SIGINT, SIGHUP] {
			signal(sig, SIG_IGN)
			let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
			source.setEventHandler { NSApp.terminate(nil) }
			source.resume()
			signalSources.append(source)
		}
		buildMenu()
		buildWindow()
		startServer()
		NSApp.activate(ignoringOtherApps: true)
	}

	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

	func applicationWillTerminate(_ notification: Notification) {
		quitting = true
		if let server, server.isRunning { server.terminate() }
	}

	// MARK: Window and menu

	private func buildWindow() {
		let config = WKWebViewConfiguration()
		config.websiteDataStore = .nonPersistent()
		webView = WKWebView(frame: .zero, configuration: config)
		webView.navigationDelegate = self
		webView.uiDelegate = self
		webView.isHidden = true
		if #available(macOS 13.3, *) { webView.isInspectable = true }

		status = NSTextField(labelWithString: "Starting SecurityX…")
		status.font = .systemFont(ofSize: 15)
		status.textColor = .secondaryLabelColor
		status.alignment = .center
		status.maximumNumberOfLines = 0
		status.lineBreakMode = .byWordWrapping

		let content = NSView()
		for view in [webView!, status!] as [NSView] {
			view.translatesAutoresizingMaskIntoConstraints = false
			content.addSubview(view)
		}
		NSLayoutConstraint.activate([
			webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
			webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
			webView.topAnchor.constraint(equalTo: content.topAnchor),
			webView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
			status.centerXAnchor.constraint(equalTo: content.centerXAnchor),
			status.centerYAnchor.constraint(equalTo: content.centerYAnchor),
			status.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor, constant: -80),
		])

		window = NSWindow(
			contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
			styleMask: [.titled, .closable, .miniaturizable, .resizable],
			backing: .buffered, defer: false)
		window.title = "SecurityX"
		window.minSize = NSSize(width: 720, height: 480)
		window.contentView = content
		window.center()
		window.setFrameAutosaveName("SecurityXMain")
		window.makeKeyAndOrderFront(nil)
	}

	private func buildMenu() {
		let main = NSMenu()
		func submenu(_ title: String, _ items: [NSMenuItem]) {
			let holder = NSMenuItem()
			let menu = NSMenu(title: title)
			items.forEach(menu.addItem)
			holder.submenu = menu
			main.addItem(holder)
		}
		func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
			let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
			it.keyEquivalentModifierMask = mods
			return it
		}
		submenu("SecurityX", [
			item("About SecurityX", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
			.separator(),
			item("Show Log", #selector(showLog), "l", [.command, .shift]),
			.separator(),
			item("Hide SecurityX", #selector(NSApplication.hide(_:)), "h"),
			item("Quit SecurityX", #selector(NSApplication.terminate(_:)), "q"),
		])
		submenu("Edit", [
			item("Undo", Selector(("undo:")), "z"),
			item("Redo", Selector(("redo:")), "z", [.command, .shift]),
			.separator(),
			item("Cut", #selector(NSText.cut(_:)), "x"),
			item("Copy", #selector(NSText.copy(_:)), "c"),
			item("Paste", #selector(NSText.paste(_:)), "v"),
			item("Select All", #selector(NSText.selectAll(_:)), "a"),
			.separator(),
			item("Find…", #selector(NSResponder.performTextFinderAction(_:)), "f"),
		])
		submenu("View", [
			item("Reload", #selector(reload), "r"),
			item("Back", #selector(goBack), "["),
			item("Forward", #selector(goForward), "]"),
			.separator(),
			item("Actual Size", #selector(zoomReset), "0"),
			item("Zoom In", #selector(zoomIn), "="),
			item("Zoom Out", #selector(zoomOut), "-"),
		])
		submenu("Window", [
			item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
			item("Close", #selector(NSWindow.performClose(_:)), "w"),
		])
		NSApp.mainMenu = main
	}

	@objc private func reload() { webView.reload() }
	@objc private func goBack() { webView.goBack() }
	@objc private func goForward() { webView.goForward() }
	@objc private func zoomReset() { webView.pageZoom = 1 }
	@objc private func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 3) }
	@objc private func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.5) }
	@objc private func showLog() { NSWorkspace.shared.open(logURL) }

	// MARK: The local server

	private func startServer() {
		guard let launcher = Bundle.main.url(forResource: "launch", withExtension: "sh") else {
			fail("This copy of SecurityX is incomplete (launch.sh is missing). Build it again with mac/build.sh.")
			return
		}
		try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
		FileManager.default.createFile(atPath: logURL.path, contents: nil)
		let log = try? FileHandle(forWritingTo: logURL)

		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/bin/sh")
		process.arguments = [launcher.path]
		let pipe = Pipe()
		process.standardOutput = pipe
		process.standardError = pipe
		pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
			let data = handle.availableData
			guard !data.isEmpty else { handle.readabilityHandler = nil; return }
			log?.write(data)
			let text = String(decoding: data, as: UTF8.self)
			DispatchQueue.main.async { self?.received(text) }
		}
		process.terminationHandler = { [weak self] proc in
			DispatchQueue.main.async { self?.serverStopped(proc.terminationStatus) }
		}
		do {
			try process.run()
			server = process
		} catch {
			fail("SecurityX could not start: \(error.localizedDescription)")
		}
	}

	private func received(_ text: String) {
		output += text
		guard origin == nil,
		      let range = output.range(of: #"http://127\.0\.0\.1:\d+/#k=[A-Za-z0-9_-]+"#, options: .regularExpression),
		      let url = URL(string: String(output[range])) else { return }
		origin = URL(string: "http://127.0.0.1:\(url.port ?? 0)")
		status.isHidden = true
		webView.isHidden = false
		webView.load(URLRequest(url: url))
	}

	private func serverStopped(_ code: Int32) {
		if quitting { return }
		let tail = output.split(separator: "\n").suffix(8).joined(separator: "\n")
		fail("SecurityX stopped (exit code \(code)).\n\n\(tail)\n\nThe full log is in ~/.securityx/app.log.")
	}

	private func fail(_ message: String) {
		webView?.isHidden = true
		status.stringValue = message
		status.isHidden = false
		status.isSelectable = true
	}

	// MARK: Navigation: the window shows only its own page

	private func isOwnPage(_ url: URL?) -> Bool {
		guard let url, let origin else { return false }
		if url.scheme == "blob" || url.scheme == "about" { return true }
		return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
	}

	func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
	             decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
		if action.shouldPerformDownload { decisionHandler(.download, preferences); return }
		if isOwnPage(action.request.url) { decisionHandler(.allow, preferences); return }
		if let url = action.request.url, url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
		decisionHandler(.cancel, preferences)
	}

	func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
	             decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
		decisionHandler(response.canShowMIMEType ? .allow : .download)
	}

	// Links that open a new tab (advisories, instructions) go to the default browser.
	func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
	             for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
		if let url = action.request.url, url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
		return nil
	}

	func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
	             initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
		let alert = NSAlert()
		alert.messageText = message
		alert.beginSheetModal(for: window) { _ in completionHandler() }
	}

	func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
	             initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
		let alert = NSAlert()
		alert.messageText = message
		alert.addButton(withTitle: "OK")
		alert.addButton(withTitle: "Cancel")
		alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
	}

	// MARK: Exports are saved to Downloads

	func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
	func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

	func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
	              completionHandler: @escaping (URL?) -> Void) {
		let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
		let name = (suggestedFilename as NSString).lastPathComponent
		let base = (name as NSString).deletingPathExtension
		let ext = (name as NSString).pathExtension
		var target = folder.appendingPathComponent(name)
		var n = 2
		while FileManager.default.fileExists(atPath: target.path) {
			target = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
			n += 1
		}
		savedTo[ObjectIdentifier(download)] = target
		completionHandler(target)
	}

	func downloadDidFinish(_ download: WKDownload) {
		if let url = savedTo.removeValue(forKey: ObjectIdentifier(download)) { NSWorkspace.shared.activateFileViewerSelecting([url]) }
	}

	func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
		let alert = NSAlert(error: error)
		alert.beginSheetModal(for: window)
	}
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

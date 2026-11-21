// Porchlight for the Mac: a window around `porchlight ui`.
//
// It starts the local web interface (through launch.sh, written by build.sh),
// waits for the link it prints, shows that page in its own window, and stops
// the interface when the window closes, or when the app ends any other way
// (a Force-Quit or a crash: see startServer). It adds nothing to the interface's
// protections: the page is still served on 127.0.0.1 with a per-run key.
//
// The page can ask it for two things only (see "The page's bridge"): a folder the owner picks, for
// a project, and showing one of Porchlight's own files in Finder.

import AppKit
import ServiceManagement
import UserNotifications
import WebKit

/// The server's output, kept in ~/.porchlight/app.log for Show Log. The folder is 0700 and the log
/// 0600, as for everything Porchlight keeps, and the session key in the page's link is never
/// written: output is held until its line ends, so a key split across two reads is masked whole.
/// Used only from the pipe's handler, which runs one call at a time. A write that fails (a full
/// disk) ends the log, never the app.
final class AppLog {
	private var handle: FileHandle?
	private var pending = Data()

	init(_ url: URL) {
		let folder = url.deletingLastPathComponent()
		try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
		// One made before this rule is corrected: the folder itself, not what is in it.
		chmod(folder.path, 0o700)
		let fd = open(url.path, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_CLOEXEC, 0o600)
		guard fd >= 0 else { return }
		// The mode given to open applies only to a new file; an earlier log is corrected before any write.
		guard fchmod(fd, 0o600) == 0 else { close(fd); return }
		handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
	}

	func write(_ data: Data) {
		guard handle != nil else { return }
		pending.append(data)
		guard let end = pending.lastIndex(of: 0x0A) else { return }
		let lines = pending[...end]
		pending = Data(pending[pending.index(after: end)...])
		put(lines)
	}

	/// The server has stopped: what is left of its last line.
	func finish() {
		if !pending.isEmpty { put(pending) }
		pending = Data()
	}

	private func put(_ data: Data) {
		do {
			try handle?.write(contentsOf: Data(AppLog.masked(String(decoding: data, as: UTF8.self)).utf8))
		} catch {
			try? handle?.close()
			handle = nil
			pending = Data()
		}
	}

	/// Everything after `#k=` up to the next space is the key: the page's link keeps it, the log does not.
	static func masked(_ text: String) -> String {
		text.replacingOccurrences(of: #"#k=\S+"#, with: "#k=(not logged)", options: .regularExpression)
	}
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandlerWithReply {
	private var window: NSWindow!
	private var webView: WKWebView!
	private var status: NSTextField!
	private var server: Process?
	/// The writing end of the server's input, held for as long as the app runs and never written to (see startServer).
	private var serverInput: FileHandle?
	private var origin: URL?
	/// The link the server printed, with its session key: kept in memory only, to load the page again if it stops.
	private var pageLink: URL?
	/// When the page was last loaded again after it stopped, so a page that keeps stopping is not reloaded in a loop.
	private var lastRecovery: Date?
	private var output = ""
	private var quitting = false
	/** Set once quitting needs no more questions: nothing was running, the owner said so, or the system asked. */
	private var quitConfirmed = false
	private var savedTo: [ObjectIdentifier: URL] = [:]
	private let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".porchlight/app.log")

	private var signalSources: [DispatchSourceSignal] = []

	/// The menu-bar item and what it last showed (FT-15): see "Menu-bar status" below.
	private var statusItem: NSStatusItem?
	private var statusTimer: Timer?
	private var lastStatus: MenuStatus?

	/// The data folder had an earlier name. It moves once, before anything writes to it, and the old
	/// path stays as a link to the new one for anything built before the rename.
	private func moveOldDataFolder() {
		let files = FileManager.default
		let home = files.homeDirectoryForCurrentUser
		let current = home.appendingPathComponent(".porchlight")
		let old = home.appendingPathComponent(".securityx")
		guard !files.fileExists(atPath: current.path) else { return }
		// attributesOfItem does not follow a link, so an old path that is already a link is left alone.
		guard let type = (try? files.attributesOfItem(atPath: old.path))?[.type] as? FileAttributeType, type == .typeDirectory else { return }
		do {
			try files.moveItem(at: old, to: current)
			try files.createSymbolicLink(atPath: old.path, withDestinationPath: ".porchlight")
		} catch {
			// Left where it is: the server then starts with nothing, and a new scan fills it.
		}
	}

	func applicationDidFinishLaunching(_ notification: Notification) {
		moveOldDataFolder()
		// Stopped from outside (kill, logout): quit the normal way, so the server stops too.
		for sig in [SIGTERM, SIGINT, SIGHUP] {
			signal(sig, SIG_IGN)
			let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
			source.setEventHandler { [weak self] in
				self?.quitConfirmed = true
				NSApp.terminate(nil)
			}
			source.resume()
			signalSources.append(source)
		}
		buildMenu()
		setUpMenuBar()
		buildWindow()
		startServer()
		NSApp.activate(ignoringOtherApps: true)
	}

	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

	// MARK: Quitting while something is running

	/// Closing the window quits the app, so it asks the same question first, while the window is still there.
	func windowShouldClose(_ sender: NSWindow) -> Bool {
		if quitConfirmed { return true }
		NSApp.terminate(nil)
		return false
	}

	/// Everything Porchlight keeps (the report, history, statuses and notes, settings, the page you were on)
	/// is saved as it changes. What a quit loses is work still running: a scan, an analysis, a model's
	/// answer. The page says what is running; if anything is, the owner chooses.
	func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
		guard !quitConfirmed, origin != nil, let webView, !webView.isHidden else { return .terminateNow }
		var answered = false
		let finish: (Bool) -> Void = { [weak self] quit in
			if answered { return }
			answered = true
			if quit { self?.quitConfirmed = true }
			NSApp.reply(toApplicationShouldTerminate: quit)
		}
		// A page that does not answer never keeps the app open.
		DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish(true) }
		webView.callAsyncJavaScript("return window.porchlightBusy ? await window.porchlightBusy() : ''", arguments: [:], in: nil, in: .page) { [weak self] result in
			let busy = ((try? result.get()) as? String) ?? ""
			if busy.isEmpty || answered { return finish(true) }
			answered = true
			let alert = NSAlert()
			alert.messageText = "Porchlight is still working"
			alert.informativeText = "\(busy).\n\nQuitting stops it, and what it has not finished is lost. Your report, history, statuses and notes are already saved."
			alert.addButton(withTitle: "Keep Working")
			alert.addButton(withTitle: "Quit Anyway")
			let quit = alert.runModal() == .alertSecondButtonReturn
			if quit { self?.quitConfirmed = true }
			NSApp.reply(toApplicationShouldTerminate: quit)
		}
		return .terminateLater
	}

	func applicationWillTerminate(_ notification: Notification) {
		quitting = true
		statusTimer?.invalidate()
		if let server, server.isRunning { server.terminate() }
	}

	// MARK: Window and menu

	private func buildWindow() {
		let config = WKWebViewConfiguration()
		config.websiteDataStore = .nonPersistent()
		config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "porchlight")
		webView = WKWebView(frame: .zero, configuration: config)
		webView.navigationDelegate = self
		webView.uiDelegate = self
		webView.isHidden = true
		if #available(macOS 13.3, *) { webView.isInspectable = true }

		status = NSTextField(labelWithString: "Starting Porchlight…")
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
		window.title = "Porchlight"
		window.minSize = NSSize(width: 720, height: 480)
		window.contentView = content
		window.center()
		window.setFrameAutosaveName("PorchlightMain")
		window.delegate = self
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
		submenu("Porchlight", [
			item("About Porchlight", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
			.separator(),
			item("Show Log", #selector(showLog), "l", [.command, .shift]),
			loginMenuItem(),
			notifyMenuItem(),
			.separator(),
			item("Hide Porchlight", #selector(NSApplication.hide(_:)), "h"),
			item("Quit Porchlight", #selector(NSApplication.terminate(_:)), "q"),
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

	@objc private func reload() {
		// After the page stopped twice in a row (see webViewWebContentProcessDidTerminate): load it again from the server's link.
		if webView.isHidden, let pageLink, server?.isRunning == true {
			status.isHidden = true
			webView.isHidden = false
			webView.load(URLRequest(url: pageLink))
			return
		}
		webView.reload()
	}
	@objc private func goBack() { webView.goBack() }
	@objc private func goForward() { webView.goForward() }
	@objc private func zoomReset() { webView.pageZoom = 1 }
	@objc private func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 3) }
	@objc private func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.5) }
	@objc private func showLog() { NSWorkspace.shared.open(logURL) }

	// MARK: The local server

	private func startServer() {
		// Made first, so the data folder is private from launch even if the server cannot start.
		let log = AppLog(logURL)
		guard let launcher = Bundle.main.url(forResource: "launch", withExtension: "sh") else {
			fail("This copy of Porchlight is incomplete (launch.sh is missing). Install it again, or build it with mac/build.sh.")
			return
		}

		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/bin/sh")
		process.arguments = [launcher.path]
		// The server stops with the app, however the app ends. Told so by PORCHLIGHT_STOP_WITH_STDIN, it
		// reads its input and exits when that input ends, which happens once nothing holds the writing end.
		// Only the app holds it, and writes nothing; the system closes it when the app goes, on a Force-Quit
		// or a crash as on a quit, so no server is left behind holding the data folder or the tailnet listener.
		let input = Pipe()
		// Not passed on to the server, or it would hold its own input open.
		_ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETFD, FD_CLOEXEC)
		process.standardInput = input
		var environment = ProcessInfo.processInfo.environment
		environment["PORCHLIGHT_STOP_WITH_STDIN"] = "1"
		process.environment = environment
		serverInput = input.fileHandleForWriting
		let pipe = Pipe()
		process.standardOutput = pipe
		process.standardError = pipe
		pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
			let data = handle.availableData
			guard !data.isEmpty else { log.finish(); handle.readabilityHandler = nil; return }
			log.write(data)
			let text = String(decoding: data, as: UTF8.self)
			DispatchQueue.main.async { self?.received(text) }
		}
		process.terminationHandler = { [weak self] proc in
			DispatchQueue.main.async { self?.serverStopped(proc.terminationStatus) }
		}
		do {
			try process.run()
			server = process
			// A server that neither prints its link nor stops leaves the window blank: after a while, say so (M15).
			DispatchQueue.main.asyncAfter(deadline: .now() + AppDelegate.startupLimit) { [weak self] in self?.startupTimedOut() }
		} catch {
			fail("Porchlight could not start: \(error.localizedDescription)")
		}
	}

	/// How long the server may take to print its link before the window says what it printed meanwhile.
	private static let startupLimit: TimeInterval = 30

	/// Still no link: the last lines the server printed, with any key masked as in the log. The server is
	/// left running, and the page still opens if the link comes later.
	private func startupTimedOut() {
		guard origin == nil, !quitting, server?.isRunning == true else { return }
		let tail = AppLog.masked(output.split(separator: "\n").suffix(8).joined(separator: "\n"))
		let printed = tail.isEmpty ? "It has printed nothing yet." : "The last it printed:\n\n\(tail)"
		fail("Porchlight has not started after \(Int(AppDelegate.startupLimit)) seconds. It is still trying, and the page opens here if it does.\n\n\(printed)\n\nThe full log is in ~/.porchlight/app.log (Porchlight → Show Log). To try again, quit and open Porchlight.")
	}

	private func received(_ text: String) {
		output += text
		guard origin == nil,
		      let range = output.range(of: #"http://127\.0\.0\.1:\d+/#k=[A-Za-z0-9_-]+"#, options: .regularExpression),
		      let url = URL(string: String(output[range])) else { return }
		origin = URL(string: "http://127.0.0.1:\(url.port ?? 0)")
		pageLink = url
		startStatusPolling()
		status.isHidden = true
		webView.isHidden = false
		webView.load(URLRequest(url: url))
	}

	private func serverStopped(_ code: Int32) {
		if quitting { return }
		let tail = output.split(separator: "\n").suffix(8).joined(separator: "\n")
		fail("Porchlight stopped (exit code \(code)).\n\n\(tail)\n\nThe full log is in ~/.porchlight/app.log.")
	}

	private func fail(_ message: String) {
		webView?.isHidden = true
		status.stringValue = message
		status.isHidden = false
		status.isSelectable = true
	}

	// MARK: Navigation: the window shows only its own page

	/// Where a link may lead outside the window: a web page in the default browser, or a pane of
	/// System Settings (the page's "System Settings → …" steps). Nothing else is opened.
	private func openOutside(_ url: URL?) {
		guard let url, let scheme = url.scheme?.lowercased() else { return }
		if scheme == "https" || scheme == "http" || scheme == "x-apple.systempreferences" { NSWorkspace.shared.open(url) }
	}

	private func isOwnPage(_ url: URL?) -> Bool {
		guard let url, let origin else { return false }
		if url.scheme == "blob" || url.scheme == "about" { return true }
		return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
	}

	func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
	             decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
		if action.shouldPerformDownload { decisionHandler(.download, preferences); return }
		if isOwnPage(action.request.url) { decisionHandler(.allow, preferences); return }
		openOutside(action.request.url)
		decisionHandler(.cancel, preferences)
	}

	/// The page's own process stopped (a crash, or the system ending it to free memory), leaving the window
	/// blank. It is loaded again from the server's link, since the key the page kept may have gone with it;
	/// the page then returns to where the owner was, and the title bar says when this happened. A page that
	/// stops again straight away is not reloaded in a loop: the window says so, and View → Reload tries again.
	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
		guard !quitting, let pageLink, server?.isRunning == true else { return }
		let now = Date()
		if let lastRecovery, now.timeIntervalSince(lastRecovery) < 30 {
			webView.isHidden = true
			status.stringValue = "The page stopped again just after it was reloaded.\n\nChoose View → Reload to try once more."
			status.isHidden = false
			status.isSelectable = true
			return
		}
		lastRecovery = now
		let time = DateFormatter.localizedString(from: now, dateStyle: .none, timeStyle: .short)
		window.subtitle = "The page stopped at \(time) and was reloaded"
		webView.load(URLRequest(url: pageLink))
	}

	func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
	             decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
		decisionHandler(response.canShowMIMEType ? .allow : .download)
	}

	// Links that open a new tab (advisories, instructions) go to the default browser.
	func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
	             for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
		openOutside(action.request.url)
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

	// MARK: The page's bridge: a folder for a project, and Show in Finder

	/// Answers the page's own main frame, nothing else. A folder chosen goes back as its path and
	/// nothing more; the server checks it before anything is written. Show in Finder only selects a
	/// file inside a folder named Porchlight (the one Porchlight writes in) and never opens it.
	func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
	                           replyHandler: @escaping (Any?, String?) -> Void) {
		let from = message.frameInfo.securityOrigin
		guard message.frameInfo.isMainFrame, let origin, from.protocol == origin.scheme, from.host == origin.host, from.port == origin.port ?? 0,
		      let body = message.body as? [String: Any], let action = body["action"] as? String else {
			replyHandler(nil, "Refused")
			return
		}
		switch action {
		case "chooseFolder":
			chooseFolder { replyHandler($0, nil) }
		case "reveal":
			replyHandler(reveal(body["path"] as? String), nil)
		default:
			replyHandler(nil, "Unknown action")
		}
	}

	private func chooseFolder(_ done: @escaping (String?) -> Void) {
		let panel = NSOpenPanel()
		panel.canChooseDirectories = true
		panel.canChooseFiles = false
		panel.allowsMultipleSelection = false
		panel.canCreateDirectories = true
		panel.prompt = "Choose"
		panel.message = "Choose the project's folder. Porchlight writes only inside a Porchlight folder within it."
		panel.beginSheetModal(for: window) { response in
			done(response == .OK ? panel.url?.path : nil)
		}
	}

	private func reveal(_ path: String?) -> Bool {
		guard let path, path.hasPrefix("/") else { return false }
		let url = URL(fileURLWithPath: path).standardizedFileURL
		guard url.pathComponents.contains("Porchlight"), FileManager.default.fileExists(atPath: url.path) else { return false }
		NSWorkspace.shared.activateFileViewerSelecting([url])
		return true
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

// MARK: Menu-bar status, notifications and launch at login (FT-15)

/// What the local server's /api/menu-status says: counts and times only, never a finding's title, place
/// or value. The menu and the notifications are built from these numbers in the app's own words.
struct MenuStatus: Decodable, Equatable {
	struct Counts: Decodable, Equatable {
		let critical: Int
		let high: Int
		let medium: Int
		let low: Int
	}
	struct Repos: Decodable, Equatable {
		let state: String
		let scannedAt: String?
		let findings: Int?
		let bySeverity: Counts?
		let complete: Bool?
	}
	struct Host: Decodable, Equatable {
		let state: String
		let checkedAt: String?
		let failed: Int?
		let couldNotCheck: Int?
	}
	let repos: Repos
	let host: Host
	let scanning: Bool
}

extension AppDelegate {
	/// How often the menu-bar item asks the server: once a minute is enough for counts and the age of a scan.
	private static let statusEvery: TimeInterval = 60
	/// The owner's switch for notifications, kept in the app's own preferences. Off until they turn it on.
	private static let notifyKey = "NotifyWhenScanFinishes"

	fileprivate func setUpMenuBar() {
		let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
		item.button?.image = NSImage(systemSymbolName: "lightbulb", accessibilityDescription: "Porchlight")
		item.button?.imagePosition = .imageLeading
		item.button?.toolTip = "Porchlight"
		statusItem = item
		drawStatus(nil)
	}

	fileprivate func startStatusPolling() {
		statusTimer?.invalidate()
		askStatus()
		let timer = Timer(timeInterval: AppDelegate.statusEvery, repeats: true) { [weak self] _ in self?.askStatus() }
		RunLoop.main.add(timer, forMode: .common)
		statusTimer = timer
	}

	/// Asks the server on this computer, with this run's key, exactly as the page does. Nothing else is contacted.
	private func askStatus() {
		guard let pageLink, let port = pageLink.port, let fragment = pageLink.fragment, fragment.hasPrefix("k="),
		      let url = URL(string: "http://127.0.0.1:\(port)/api/menu-status") else { return }
		var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
		request.setValue(String(fragment.dropFirst(2)), forHTTPHeaderField: "x-porchlight-session")
		let session = URLSession(configuration: .ephemeral)
		session.dataTask(with: request) { [weak self] data, response, _ in
			let ok = (response as? HTTPURLResponse)?.statusCode == 200
			let decoded = ok ? data.flatMap { try? JSONDecoder().decode(MenuStatus.self, from: $0) } : nil
			DispatchQueue.main.async { self?.received(status: decoded) }
		}.resume()
		session.finishTasksAndInvalidate()
	}

	private func received(status: MenuStatus?) {
		let before = lastStatus
		if let status { lastStatus = status }
		drawStatus(status)
		// A scan that finished since the last look: said once, from the counts alone.
		if let status, let before, let finished = status.repos.scannedAt, finished != before.repos.scannedAt, !status.scanning {
			notify(title: "Porchlight: scan finished", body: AppDelegate.findingsWords(status.repos) + (status.repos.complete == false ? " Not everything was covered." : ""))
		}
	}

	private func drawStatus(_ status: MenuStatus?) {
		guard let statusItem else { return }
		let counts = status?.repos.bySeverity
		let urgent = (counts?.critical ?? 0) + (counts?.high ?? 0)
		statusItem.button?.title = urgent > 0 ? " \(urgent)" : ""
		statusItem.button?.image = NSImage(systemSymbolName: urgent > 0 ? "lightbulb.fill" : "lightbulb", accessibilityDescription: urgent > 0 ? "Porchlight: \(urgent) critical or high" : "Porchlight")
		let menu = NSMenu()
		func line(_ text: String) {
			let entry = NSMenuItem(title: text, action: nil, keyEquivalent: "")
			entry.isEnabled = false
			menu.addItem(entry)
		}
		if let status {
			if status.scanning { line("Scanning now…") }
			switch status.repos.state {
			case "read":
				line(AppDelegate.findingsWords(status.repos))
				if let at = status.repos.scannedAt { line("Last scan: \(AppDelegate.age(at))") }
				if status.repos.complete == false { line("Not everything was covered") }
			case "unreadable": line("The last scan could not be read")
			default: line("No scan yet")
			}
			switch status.host.state {
			case "read":
				let failed = status.host.failed ?? 0
				let unknown = status.host.couldNotCheck ?? 0
				line("This computer: \(failed == 1 ? "1 problem" : "\(failed) problems")\(unknown > 0 ? ", \(unknown) not checked" : "")")
			case "unreadable": line("This computer: the last check could not be read")
			default: line("This computer: not checked yet")
			}
		} else {
			line(pageLink == nil ? "Starting…" : "Waiting for Porchlight to answer")
		}
		menu.addItem(.separator())
		menu.addItem(NSMenuItem(title: "Open Porchlight", action: #selector(showMainWindow), keyEquivalent: ""))
		menu.addItem(loginMenuItem())
		menu.addItem(notifyMenuItem())
		menu.addItem(.separator())
		menu.addItem(NSMenuItem(title: "Quit Porchlight", action: #selector(NSApplication.terminate(_:)), keyEquivalent: ""))
		statusItem.menu = menu
	}

	/// "3 findings: 1 critical, 2 high", in the app's own words.
	static func findingsWords(_ repos: MenuStatus.Repos) -> String {
		let total = repos.findings ?? 0
		let head = total == 1 ? "1 finding" : "\(total) findings"
		guard let counts = repos.bySeverity else { return head }
		let parts = [("critical", counts.critical), ("high", counts.high), ("medium", counts.medium), ("low", counts.low)].filter { $0.1 > 0 }.map { "\($0.1) \($0.0)" }
		return parts.isEmpty ? head : "\(head): \(parts.joined(separator: ", "))"
	}

	/// How long ago an ISO time was, in words.
	static func age(_ iso: String) -> String {
		let parser = ISO8601DateFormatter()
		parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		guard let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
		let formatter = RelativeDateTimeFormatter()
		formatter.unitsStyle = .full
		return formatter.localizedString(for: date, relativeTo: Date())
	}

	@objc fileprivate func showMainWindow() {
		NSApp.activate(ignoringOtherApps: true)
		window.makeKeyAndOrderFront(nil)
	}

	// Launch at login: the owner's switch, off until they turn it on. Porchlight never turns it on itself.

	fileprivate func loginMenuItem() -> NSMenuItem {
		let entry = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin), keyEquivalent: "")
		entry.target = self
		entry.state = SMAppService.mainApp.status == .enabled ? .on : .off
		return entry
	}

	@objc private func toggleLogin(_ sender: NSMenuItem) {
		let service = SMAppService.mainApp
		do {
			if service.status == .enabled { try service.unregister() } else { try service.register() }
		} catch {
			let alert = NSAlert()
			alert.messageText = "Porchlight could not change Open at Login"
			alert.informativeText = "\(error.localizedDescription)\n\nYou can also add or remove it in System Settings, under General, Login Items."
			alert.runModal()
		}
		refreshMenus()
	}

	// Notifications: the owner's switch, off until they turn it on, and only Porchlight's own words and counts.

	fileprivate func notifyMenuItem() -> NSMenuItem {
		let entry = NSMenuItem(title: "Notify When a Scan Finishes", action: #selector(toggleNotify), keyEquivalent: "")
		entry.target = self
		entry.state = UserDefaults.standard.bool(forKey: AppDelegate.notifyKey) ? .on : .off
		return entry
	}

	@objc private func toggleNotify(_ sender: NSMenuItem) {
		let on = !UserDefaults.standard.bool(forKey: AppDelegate.notifyKey)
		UserDefaults.standard.set(on, forKey: AppDelegate.notifyKey)
		if on { UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { _, _ in } }
		refreshMenus()
	}

	private func notify(title: String, body: String) {
		guard UserDefaults.standard.bool(forKey: AppDelegate.notifyKey) else { return }
		let content = UNMutableNotificationContent()
		content.title = title
		content.body = body
		UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
	}

	private func refreshMenus() {
		buildMenu()
		drawStatus(lastStatus)
	}
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

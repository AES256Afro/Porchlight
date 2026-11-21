// Network failures said in the owner's words (R6U-10), shared by the page (api.js) and the server
// (the errors it answers with), so a message is put into plain words once, the same in both.

/**
 * A network failure said in the page's words: Node's bare "fetch failed" and a DNS answer's status
 * number mean nothing to the owner. The rest of the message is kept as it was, and a message already
 * in plain words comes back unchanged, so applying it twice changes nothing.
 *
 * @param {string} message
 */
export function plainError(message) {
	return message
		.replace(/\bno answer \(DNS status 2\)/g, "the domain's DNS answered with an error (SERVFAIL), often a DNSSEC problem")
		.replace(/\bno answer \(DNS status 3\)/g, "the name does not exist in DNS")
		.replace(/\bDNS status 2\b/g, "a DNS error (SERVFAIL), often a DNSSEC problem")
		.replace(/\bDNS status 3\b/g, "a DNS answer that the name does not exist")
		.replace(/:\s*fetch failed\.?$/i, ": no connection could be made (the address could not be found, or nothing answered)")
		.replace(/^fetch failed\.?$/i, "No connection could be made: the address could not be found, or nothing answered.")
		.replace(/\bgetaddrinfo ENOTFOUND (\S+)/g, "the address $1 could not be found")
		.replace(/\bconnect ECONNREFUSED (\S+)/g, "nothing answered at $1")
		.replace(/\bThe operation was aborted due to timeout\b/g, "no answer came in time");
}

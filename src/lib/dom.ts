// Small helpers over the DOM: telling whether a control
// takes typed text, and finding a control again after a redraw replaced it.

/** The parts of an element isTyping() looks at, so it can be tested without a DOM. */
type Typed = { tagName?: string; type?: string; isContentEditable?: boolean }

/** True when el takes typed text, so redrawing it would lose what is being typed. */
export function isTyping(el: Typed | Element | EventTarget | null | undefined): boolean {
    if (!el) return false
    const e = el as Typed
    if (e.isContentEditable || e.tagName === "TEXTAREA" || e.tagName === "SELECT") return true
    return e.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(e.type ?? "")
}

/** The same control in new markup, found by its id or a data attribute. */
export function refind(el: Element | null): Element | null {
    if (!el || el.isConnected) return el
    if (el.id) return document.getElementById(el.id)
    for (const [key, value] of Object.entries((el as HTMLElement).dataset || {})) {
        const attr = "data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())
        const found = document.querySelector("[" + attr + '="' + CSS.escape(value ?? "") + '"]')
        if (found) return found
    }
    return null
}

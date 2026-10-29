// The Cloudflare Turnstile check that lifts a locked sign-in (worker/captcha.js). Shown only
// while the name is locked and the server gave a site key. It reports each token it issues
// (or "" when the token expires) and is removed when it unmounts.

import { useEffect, useRef, useState } from "react"

interface Turnstile {
    render(el: HTMLElement, options: Record<string, unknown>): string
    remove(widgetId: string): void
}

const turnstileWindow = window as Window & { turnstile?: Turnstile }
let script: Promise<Turnstile> | undefined

/** Loads Turnstile's script once; resolves to its API. */
function loadTurnstile(): Promise<Turnstile> {
    if (turnstileWindow.turnstile) return Promise.resolve(turnstileWindow.turnstile)
    script ??= new Promise<Turnstile>((resolve, reject) => {
        const el = document.createElement("script")
        el.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        el.async = true
        const fail = () => {
            script = undefined
            el.remove()
            reject(new Error("turnstile"))
        }
        el.onload = () => (turnstileWindow.turnstile ? resolve(turnstileWindow.turnstile) : fail())
        el.onerror = fail
        document.head.append(el)
    })
    return script
}

export function SignInCheck({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
    const ref = useRef<HTMLDivElement>(null)
    const [failed, setFailed] = useState(false)
    // Held in a ref so a new callback identity from the parent does not re-render the widget.
    const onTokenRef = useRef(onToken)
    useEffect(() => {
        onTokenRef.current = onToken
    }, [onToken])
    useEffect(() => {
        let gone = false
        let widget: { api: Turnstile; id: string } | undefined
        const report = (token: string) => onTokenRef.current(token)
        loadTurnstile().then((api) => {
            if (gone || !ref.current) return
            widget = {
                api,
                id: api.render(ref.current, {
                    sitekey: siteKey,
                    action: "login",   /* worker/captcha.js accepts only this action */
                    callback: report,
                    "expired-callback": () => report(""),
                    "error-callback": () => report(""),
                }),
            }
        }, () => setFailed(true))
        return () => {
            gone = true
            if (widget) widget.api.remove(widget.id)
        }
    }, [siteKey])
    if (failed) return <p role="alert" className="m-0 text-center text-sm text-destructive">The check could not load. Check your connection and try again.</p>
    return <div ref={ref} className="flex justify-center" />
}

// The sign-in form, inside <App>'s #signin. session.ts decides when it shows and passes
// the last error (src/data/signin.ts); submitting calls
// its signIn(), which reloads on success or shows the form again with the reason.

import { useEffect, useReducer, useRef, useState, type FormEvent } from "react"
import { signIn } from "@/data/session"
import { useSignInState } from "@/data/signin"
import { Card } from "@/components/ui/card"
import { TextureButton } from "@/components/ui/texture-button"
import { SignInCheck } from "@/components/sign-in-check"

const field =
    "w-full rounded-[10px] border border-border bg-card px-3 py-2 text-[15px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25"
const label = "mt-1 text-left text-xs font-medium text-muted-foreground"

export function SignIn() {
    const { error, username: kept, shown, lockedUntil, captchaSiteKey } = useSignInState()
    const [username, setUsername] = useState(kept)
    const [password, setPassword] = useState("")
    const [busy, setBusy] = useState(false)
    // The CAPTCHA token for a locked sign-in: single use, so the check is redrawn after each submit.
    const [captcha, setCaptcha] = useState("")
    const [round, setRound] = useState(0)
    const [, tick] = useReducer((n: number) => n + 1, 0)
    const locked = lockedUntil > Date.now()
    const checkShown = locked && captchaSiteKey !== ""
    // A lock's message (it comes with lockedUntil) is out of date once the lock has passed.
    const message = lockedUntil && !locked ? "" : error
    // Re-render when the lock ends, so the form re-enables itself. A little past the wait,
    // so a timer that fires a hair early still finds the lock over.
    useEffect(() => {
        const wait = lockedUntil - Date.now()
        if (wait <= 0) return
        const timer = setTimeout(tick, wait + 100)
        return () => clearTimeout(timer)
    }, [lockedUntil])
    const userRef = useRef<HTMLInputElement>(null)
    const passRef = useRef<HTMLInputElement>(null)

    // Each time session.ts shows the screen: keep the username, clear the password,
    // stop waiting, and focus the field to type in next.
    useEffect(() => {
        setUsername(kept)
        setPassword("")
        setBusy(false)
        setCaptcha("")
        setRound((r) => r + 1)
        ;(kept ? passRef : userRef).current?.focus()
    }, [shown, kept])

    function submit(e: FormEvent) {
        e.preventDefault()
        if (busy || (locked && !captcha)) return
        setBusy(true)
        setCaptcha("")
        if (locked) void signIn(username, password, captcha)
        else void signIn(username, password)
    }

    return (
        <Card className="w-[min(380px,100%)]">
            <form id="loginForm" autoComplete="on" onSubmit={submit} className="flex flex-col gap-1.5 px-7 pt-8 pb-6 text-center">
                <h1 className="m-0 leading-none">
                    <span className="font-serif text-6xl font-semibold tracking-[-.02em]">Term</span>
                </h1>
                <p className="m-0 mb-4 text-sm text-muted-foreground">Your term, in one place.</p>

                <label htmlFor="loginUser" className={label}>Username</label>
                <input
                    ref={userRef}
                    id="loginUser"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={32}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={field}
                />
                <label htmlFor="loginPass" className={label}>Password</label>
                <input
                    ref={passRef}
                    id="loginPass"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={field}
                />
                {message && <p role="alert" className="m-0 mt-1 text-left text-sm text-destructive">{message}</p>}
                {checkShown && <SignInCheck key={round} siteKey={captchaSiteKey} onToken={setCaptcha} />}
                <TextureButton type="submit" variant="accent" size="lg" disabled={busy || (locked && !captcha)} className="mt-3 w-full disabled:opacity-70">
                    {busy ? "Signing in…" : "Sign in"}
                </TextureButton>
                <p className="m-0 mt-2 text-center text-xs text-muted-foreground">Forgot your password? Ask whoever runs Term to reset it.</p>
            </form>
        </Card>
    )
}

// The sign-in form, inside <App>'s #signin. session.ts decides when it shows and passes
// the last error (src/data/signin.ts); submitting calls
// its signIn(), which reloads on success or shows the form again with the reason.

import { useEffect, useRef, useState, type FormEvent } from "react"
import { signIn } from "@/data/session"
import { useSignInState } from "@/data/signin"
import { Card } from "@/components/ui/card"
import { TextureButton } from "@/components/ui/texture-button"

const field =
    "w-full rounded-[10px] border border-border bg-card px-3 py-2 text-[15px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25"
const label = "mt-1 text-left text-xs font-medium text-muted-foreground"

export function SignIn() {
    const { error, username: kept, shown } = useSignInState()
    const [username, setUsername] = useState(kept)
    const [password, setPassword] = useState("")
    const [busy, setBusy] = useState(false)
    const userRef = useRef<HTMLInputElement>(null)
    const passRef = useRef<HTMLInputElement>(null)

    // Each time session.ts shows the screen: keep the username, clear the password,
    // stop waiting, and focus the field to type in next.
    useEffect(() => {
        setUsername(kept)
        setPassword("")
        setBusy(false)
        ;(kept ? passRef : userRef).current?.focus()
    }, [shown, kept])

    function submit(e: FormEvent) {
        e.preventDefault()
        if (busy) return
        setBusy(true)
        void signIn(username, password)
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
                {error && <p role="alert" className="m-0 mt-1 text-left text-sm text-destructive">{error}</p>}
                <TextureButton type="submit" variant="accent" size="lg" disabled={busy} className="mt-3 w-full disabled:opacity-70">
                    {busy ? "Signing in…" : "Sign in"}
                </TextureButton>
            </form>
        </Card>
    )
}

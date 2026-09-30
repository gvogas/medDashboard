import { Drawing, Frame, Tag, TORSO, type PictureProps } from "./parts"
import { fitStyle, nameParts } from "./names"

/** Aviation: a leather flight jacket, fleece collar, wings, a name tape with the goal under it. */
export function Jacket({ name, goal }: PictureProps) {
    const last = nameParts(name).capsLast
    return (
        <Frame bg="pilot" name={name} goal={goal}>
            <Drawing>
                <path d={TORSO} fill="#6B4A34" />
                <path d="M86 24L110 62L134 24Q110 30 86 24Z" fill="#8A9A7B" />
                <path d="M86 24L66 30L56 72L98 60Z" fill="#E7DCC8" />
                <path d="M134 24L154 30L164 72L122 60Z" fill="#E7DCC8" />
                <path d="M110 62V180" stroke="#C9A24A" strokeWidth="2" strokeDasharray="2 2" />
                <rect x="107" y="66" width="6" height="11" rx="1.5" fill="#C9A24A" />
                <path d="M62 96c-6-6-18-7-28-5 8 2 14 5 18 8-6-1-12 0-16 2 8 1 16 2 26-1Z" fill="#C9A24A" />
                <path d="M62 96c6-6 18-7 28-5-8 2-14 5-18 8 6-1 12 0 16 2-8 1-16 2-26-1Z" fill="#C9A24A" />
                <circle cx="62" cy="96" r="3.5" fill="#C9A24A" />
                <rect x="36" y="108" width="52" height="14" rx="1.5" fill="#2E2A22" />
                <rect x="132" y="112" width="44" height="34" rx="3" fill="none" stroke="#523826" strokeWidth="1.5" />
                <path d="M132 112h44v8l-22 6-22-6Z" fill="#5C3F2C" />
            </Drawing>
            <Tag x={62} y={111.4} style={fitStyle(last, 48, 8, 0.6, 1)} className="font-mono text-[#E7DCC8]">{last}</Tag>
            <Tag x={62} y={130.4} style={fitStyle(goal, 80, 6.8, 0.6, 0.6)} className="font-mono text-[#E7DCC8]">{goal.toUpperCase()}</Tag>
        </Frame>
    )
}

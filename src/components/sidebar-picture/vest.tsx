import { Drawing, Frame, Tag, TORSO, type PictureProps } from "./parts"
import { fitSize, nameParts } from "./names"

/** Engineering: a hi-vis vest over a dark shirt, a name tag with the goal. */
export function Vest({ name, goal }: PictureProps) {
    const short = nameParts(name).capsShort
    return (
        <Frame bg="eng" name={name} goal={goal}>
            <Drawing>
                <path d={TORSO} fill="#3F4750" />
                <path d="M86 24L110 64L134 24Q110 32 86 24Z" fill="#2B3138" />
                <path d="M40 40L86 26L104 84V180H40Z" fill="#F07F1E" />
                <path d="M180 40L134 26L116 84V180H180Z" fill="#F07F1E" />
                <path d="M58 36l10-3 12 50h-10Z" fill="#D9DDE0" />
                <path d="M162 36l-10-3-12 50h10Z" fill="#D9DDE0" />
                <rect x="40" y="124" width="64" height="10" fill="#D9DDE0" />
                <rect x="116" y="124" width="64" height="10" fill="#D9DDE0" />
                <rect x="40" y="148" width="64" height="10" fill="#D9DDE0" />
                <rect x="116" y="148" width="64" height="10" fill="#D9DDE0" />
                <rect x="120" y="92" width="64" height="28" rx="2" fill="#FFFFFF" />
                <rect x="52" y="90" width="3" height="18" rx="1.5" fill="#1C1C1A" />
                <rect x="58" y="92" width="3" height="16" rx="1.5" fill="#2B5F8A" />
            </Drawing>
            <Tag x={152} y={97.9} style={{ fontSize: fitSize(short, 58, 7.5, 0.6, 1) }} className="font-semibold tracking-[1px] text-[#1C1C1A]">{short}</Tag>
            <Tag x={152} y={110.1} style={{ fontSize: fitSize(goal, 58, 6, 0.6, 0.5) }} className="font-semibold tracking-[.5px] text-[#D9651A]">{goal.toUpperCase()}</Tag>
        </Frame>
    )
}

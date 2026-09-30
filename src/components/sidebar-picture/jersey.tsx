import { THEMES } from "@/data/themes"
import { Drawing, Frame, Tag, type PictureProps } from "./parts"
import { fitSize, nameParts } from "./names"

/** Sports: the back of a jersey in the theme's colour, the surname, a 7, the goal at the hem. */
export function Jersey({ name, goal }: PictureProps) {
    const last = nameParts(name).capsLast
    return (
        <Frame bg="sports" name={name} goal={goal}>
            <Drawing>
                <path d="M62 14Q110 30 158 14L200 32L218 76L190 88L178 64V180H42V64L30 88L2 76L20 32Z" fill={THEMES.sports.accent} />
                <path d="M62 14Q110 30 158 14" stroke="#FFFFFF" strokeWidth="3" fill="none" />
                <path d="M8 72L28 80M212 72L192 80" stroke="#FFFFFF" strokeWidth="3" />
            </Drawing>
            <Tag x={110} y={49.7} style={{ fontSize: fitSize(last, 120, 15, 0.6, 2) }} className="font-semibold tracking-[2px] text-white">{last}</Tag>
            <Tag x={110} y={84.6} className="text-[70px] font-semibold text-white">7</Tag>
            <Tag x={110} y={158.6} style={{ fontSize: fitSize(goal, 124, 9, 0.6, 1.5) }} className="font-semibold tracking-[1.5px] text-white opacity-85">{goal.toUpperCase()}</Tag>
        </Frame>
    )
}

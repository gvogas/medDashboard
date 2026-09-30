import { Drawing, Frame, type PictureProps } from "./parts"
import { coatSize } from "./names"

/** Medicine: the lab coat, the name embroidered over the pocket, the goal under it, a stethoscope. */
export function Coat({ name, goal }: PictureProps) {
    return (
        <Frame bg="med" name={name} goal={goal}>
            <Drawing>
                <path d="M18 180V70Q18 44 48 36L86 24L110 64L134 24L172 36Q202 44 202 70V180Z" fill="var(--coat)" stroke="#CFCBC2" strokeWidth="1.2" />
                <path d="M86 24L110 64L134 24Q110 32 86 24Z" fill="#2F6F6A" />
                <path d="M86 24L110 64L100 106L72 44Z" fill="#000000" fillOpacity=".05" stroke="#CFCBC2" strokeWidth="1.2" />
                <path d="M134 24L110 64L120 106L148 44Z" fill="#000000" fillOpacity=".05" stroke="#CFCBC2" strokeWidth="1.2" />
                <path d="M110 106V180" stroke="#CFCBC2" strokeWidth="1.2" />
                <circle cx="116" cy="128" r="2.6" fill="#CFCBC2" />
                <circle cx="116" cy="158" r="2.6" fill="#CFCBC2" />
                <rect x="168" y="103" width="3.5" height="12" rx="1.75" fill="#2B5F8A" />
                <rect x="174" y="105" width="3.5" height="10" rx="1.75" fill="#B3362B" />
                <path d="M140 110h44v32q0 4-4 4h-36q-4 0-4-4Z" fill="var(--coat)" stroke="#CFCBC2" strokeWidth="1.2" />
                <path d="M78 30Q48 82 62 126" stroke="#3A3935" strokeWidth="3" fill="none" strokeLinecap="round" />
                <circle cx="63" cy="133" r="7" fill="#B8BDBC" stroke="#3A3935" strokeWidth="2" />
            </Drawing>
            <span aria-hidden="true" className="absolute flex -translate-x-1/2 flex-col items-center gap-[3px] leading-none whitespace-nowrap text-[#1F4E7A]" style={{ left: 166, top: 76 }}>
                <span className="font-serif font-semibold tracking-[.01em] italic" style={{ fontSize: coatSize(name) }}>{name}</span>
                <span className="text-[6px] font-semibold tracking-[.12em] opacity-75">{goal.toUpperCase()}</span>
            </span>
        </Frame>
    )
}

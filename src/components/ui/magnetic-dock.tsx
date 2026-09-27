"use client"

// From @componentry/magnetic-dock, adapted for Rounds: Texture styling on Rounds' tokens,
// a "tray" variant, labels below a top dock, a text badge, a shortcut in the label, and
// aria-pressed (it switches views; it does not navigate). The preset icons are dropped.

import * as React from "react"
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence, useReducedMotion, type MotionValue } from "framer-motion"
import { cn } from "@/lib/utils"

interface MagneticDockProps {
    /** Array of dock items */
    items: DockItemData[]
    /** Size of icons in pixels */
    iconSize?: number
    /** Maximum scale on hover */
    maxScale?: number
    /** Distance of magnetic effect in pixels */
    magneticDistance?: number
    /** Show labels on hover */
    showLabels?: boolean
    /** Dock position */
    position?: "bottom" | "top" | "left" | "right"
    /** Background style */
    variant?: "glass" | "solid" | "transparent" | "tray"
    /** Custom class name */
    className?: string
    /** Accessible name for the group */
    "aria-label"?: string
}

interface DockItemData {
    /** Unique identifier */
    id: string
    /** Display label */
    label: string
    /** Icon component or image URL */
    icon: React.ReactNode
    /** Click handler */
    onClick?: () => void
    /** Whether item is active */
    isActive?: boolean
    /** Badge: a count, or short text such as a timer */
    badge?: number | string | null
    /** Keyboard shortcut shown in the label */
    shortcut?: string
}

interface DockItemProps {
    item: DockItemData
    mouseX: MotionValue<number>
    iconSize: number
    maxScale: number
    magneticDistance: number
    showLabels: boolean
    position: NonNullable<MagneticDockProps["position"]>
    reducedMotion: boolean
}

function badgeText(badge: DockItemData["badge"]): string | null {
    if (badge === undefined || badge === null || badge === "" || badge === 0) return null
    if (typeof badge === "number") return badge > 99 ? "99+" : String(badge)
    return badge
}

function DockItem({
    item,
    mouseX,
    iconSize,
    maxScale,
    magneticDistance,
    showLabels,
    position,
    reducedMotion,
}: DockItemProps) {
    const ref = React.useRef<HTMLButtonElement>(null)
    const [isHovered, setIsHovered] = React.useState(false)
    const [isFocused, setIsFocused] = React.useState(false)
    const showLabel = showLabels && (isHovered || isFocused)
    const isVertical = position === "left" || position === "right"
    const badge = badgeText(item.badge)

    // Calculate distance from mouse to center of item
    const distance = useTransform(mouseX, (val: number) => {
        if (!ref.current) return magneticDistance + 1
        const rect = ref.current.getBoundingClientRect()
        const center = isVertical
            ? rect.top + rect.height / 2
            : rect.left + rect.width / 2
        return val - center
    })

    // Scale based on distance - closer = larger
    const scale = useTransform(distance, [-magneticDistance, 0, magneticDistance], [1, maxScale, 1])

    // Apply spring physics for smooth animation
    const springConfig = { damping: 20, stiffness: 300, mass: 0.5 }
    const smoothScale = useSpring(scale, springConfig)

    // Calculate the size based on scale
    const size = useTransform(smoothScale, (s) => s * iconSize)

    // Floating effect, away from the edge the dock sits on (none for a top dock)
    const y = useTransform(smoothScale, (s) => (s - 1) * -10)
    const smoothY = useSpring(y, springConfig)
    const floats = !reducedMotion && position === "bottom"

    return (
        <motion.button
            ref={ref}
            type="button"
            aria-label={item.label}
            aria-pressed={item.isActive ? "true" : "false"}
            data-dock-item={item.id}
            onClick={item.onClick}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={cn(
                "relative flex flex-none items-center justify-center p-0",
                "rounded-[9px] border bg-transparent",
                "transition-colors duration-150",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                item.isActive
                    ? "border-primary/35 text-accent-foreground dark:text-primary"
                    : "border-border text-ink-2 hover:text-foreground"
            )}
            style={{
                width: reducedMotion ? iconSize : size,
                height: reducedMotion ? iconSize : size,
                y: floats && !isVertical ? smoothY : 0,
                x: floats && isVertical ? smoothY : 0,
            }}
            whileTap={reducedMotion ? undefined : { scale: 0.9 }}
        >
            {/* Icon container: the Texture look, a light rim over the panel gradient */}
            <span
                className={cn(
                    "relative flex h-full w-full items-center justify-center overflow-hidden rounded-[8px]",
                    item.isActive
                        ? "bg-accent"
                        : "bg-gradient-to-b from-card to-muted",
                    "shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_1px_2px_rgba(20,48,45,.08)]",
                    "dark:shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_1px_2px_rgba(0,0,0,.4)]"
                )}
            >
                <span aria-hidden="true" className="flex h-[58%] w-[58%] items-center justify-center">
                    {item.icon}
                </span>
            </span>

            {/* Badge */}
            <AnimatePresence initial={false}>
                {badge && (
                    <motion.span
                        data-dock-badge
                        initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={reducedMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
                        className={cn(
                            "absolute -top-2 -right-3.5 z-10",
                            "rounded-md px-1 py-px",
                            "bg-[var(--study-card)] text-[#FCE4EE]",
                            "font-mono text-[9px] font-semibold leading-tight whitespace-nowrap tabular-nums",
                            "shadow-[0_0_0_2px_var(--panel)]"
                        )}
                    >
                        {badge}
                    </motion.span>
                )}
            </AnimatePresence>

            {/* Active Indicator */}
            <AnimatePresence initial={false}>
                {item.isActive && (
                    <motion.span
                        aria-hidden="true"
                        initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={reducedMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
                        className="absolute -bottom-[5px] left-1/2 -ml-0.5 h-1 w-1 rounded-full bg-primary"
                    />
                )}
            </AnimatePresence>

            {/* Tooltip: below a top dock, above any other */}
            <AnimatePresence initial={false}>
                {showLabel && (
                    <motion.span
                        aria-hidden="true"
                        initial={reducedMotion ? false : { opacity: 0, y: position === "top" ? -6 : 6, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: position === "top" ? -6 : 6, scale: 0.94 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className={cn(
                            "absolute left-1/2 -translate-x-1/2",
                            position === "top" ? "top-[calc(100%+9px)]" : "bottom-[calc(100%+9px)]",
                            "rounded-md px-[7px] py-[3px]",
                            "bg-foreground text-card",
                            "text-[11px] font-semibold whitespace-nowrap",
                            "pointer-events-none z-50"
                        )}
                    >
                        {item.label}
                        {item.shortcut && (
                            <span className="ml-1 font-mono text-[10px] font-medium opacity-70">{item.shortcut}</span>
                        )}
                    </motion.span>
                )}
            </AnimatePresence>
        </motion.button>
    )
}

function MagneticDock({
    items,
    iconSize = 56,
    maxScale = 1.5,
    magneticDistance = 150,
    showLabels = true,
    position = "bottom",
    variant = "glass",
    className,
    "aria-label": ariaLabel,
}: MagneticDockProps) {
    const mousePosition = useMotionValue(Infinity)
    const reducedMotion = useReducedMotion() ?? false
    const isVertical = position === "left" || position === "right"

    const handleMouseMove = React.useCallback(
        (e: React.MouseEvent) => {
            if (isVertical) {
                mousePosition.set(e.clientY)
            } else {
                mousePosition.set(e.clientX)
            }
        },
        [mousePosition, isVertical]
    )

    const handleMouseLeave = () => {
        mousePosition.set(Infinity)
    }

    const variantStyles = {
        glass: "bg-card/80 backdrop-blur-xl backdrop-saturate-150 border border-border shadow-xl shadow-black/10 dark:shadow-black/30",
        solid: "bg-muted border border-border shadow-xl shadow-black/10 dark:shadow-black/30",
        transparent: "bg-transparent border-0",
        tray: "bg-muted/70 border border-border",
    }

    const layoutStyles = {
        bottom: "flex-row items-end gap-2 p-3 rounded-3xl",
        top: "flex-row items-center gap-[5px] h-10 px-1.5 rounded-[14px]",
        left: "flex-col items-end gap-2 p-3 rounded-3xl",
        right: "flex-col items-start gap-2 p-3 rounded-3xl",
    }

    return (
        <div
            role="group"
            aria-label={ariaLabel}
            onMouseMove={reducedMotion ? undefined : handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className={cn(
                "inline-flex flex-none",
                layoutStyles[position],
                variantStyles[variant],
                className
            )}
        >
            {items.map((item) => (
                <DockItem
                    key={item.id}
                    item={item}
                    mouseX={mousePosition}
                    iconSize={iconSize}
                    maxScale={maxScale}
                    magneticDistance={magneticDistance}
                    showLabels={showLabels}
                    position={position}
                    reducedMotion={reducedMotion}
                />
            ))}
        </div>
    )
}

export { MagneticDock, type MagneticDockProps, type DockItemData }

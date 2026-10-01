import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...values: Parameters<typeof clsx>) => twMerge(clsx(values))

import { clsx, type ClassValue } from 'clsx';

/** Tiny class-name joiner used across components. */
export const cn = (...inputs: ClassValue[]) => clsx(inputs);

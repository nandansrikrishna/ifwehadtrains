import { useEffect } from 'react';

export interface KeyboardCommand {
    id: string;
    enabled?: boolean;
    preventDefault?: boolean;
    stopPropagation?: boolean;
    allowInTextInput?: boolean;
    matches: (event: KeyboardEvent) => boolean;
    handler: (event: KeyboardEvent) => void;
}

function isTextInputTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    return (
        element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.isContentEditable
    );
}

export function useKeyboardCommands(commands: KeyboardCommand[]): void {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            for (const command of commands) {
                if (command.enabled === false) continue;
                if (!command.allowInTextInput && isTextInputTarget(event.target)) continue;
                if (!command.matches(event)) continue;

                if (command.preventDefault !== false) event.preventDefault();
                if (command.stopPropagation) event.stopPropagation();
                command.handler(event);
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [commands]);
}

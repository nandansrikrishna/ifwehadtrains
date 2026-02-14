import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface HistoryAction<TActionType extends string = string, TPayload = unknown> {
    type: TActionType;
    payload: TPayload;
}

export interface HistoryEntry<TActionType extends string = string> {
    redo: HistoryAction<TActionType>;
    undo: HistoryAction<TActionType>;
}

export type ActionHandlers<TState, TActionType extends string> = {
    [K in TActionType]: (state: TState, payload: unknown) => TState;
};

interface UseActionHistoryResult<TState, TActionType extends string> {
    state: TState;
    setState: Dispatch<SetStateAction<TState>>;
    execute: (entry: HistoryEntry<TActionType>) => void;
    record: (entry: HistoryEntry<TActionType>) => void;
    undo: () => boolean;
    redo: () => boolean;
    clearHistory: () => void;
    canUndo: boolean;
    canRedo: boolean;
}

export function useActionHistory<TState, TActionType extends string>(
    initialState: TState,
    handlers: ActionHandlers<TState, TActionType>
): UseActionHistoryResult<TState, TActionType> {
    const [state, setState] = useState<TState>(initialState);
    const undoStackRef = useRef<HistoryEntry<TActionType>[]>([]);
    const redoStackRef = useRef<HistoryEntry<TActionType>[]>([]);
    const [stackVersion, setStackVersion] = useState(0);

    const bumpVersion = useCallback(() => {
        setStackVersion((value) => value + 1);
    }, []);

    const applyAction = useCallback((previous: TState, action: HistoryAction<TActionType>): TState => {
        const handler = handlers[action.type];
        return handler(previous, action.payload);
    }, [handlers]);

    const execute = useCallback((entry: HistoryEntry<TActionType>) => {
        setState((previous) => applyAction(previous, entry.redo));
        undoStackRef.current.push(entry);
        redoStackRef.current = [];
        bumpVersion();
    }, [applyAction, bumpVersion]);

    // Use this when caller has already applied the state change manually.
    const record = useCallback((entry: HistoryEntry<TActionType>) => {
        undoStackRef.current.push(entry);
        redoStackRef.current = [];
        bumpVersion();
    }, [bumpVersion]);

    const undo = useCallback(() => {
        const entry = undoStackRef.current.pop();
        if (!entry) return false;

        setState((previous) => applyAction(previous, entry.undo));
        redoStackRef.current.push(entry);
        bumpVersion();
        return true;
    }, [applyAction, bumpVersion]);

    const redo = useCallback(() => {
        const entry = redoStackRef.current.pop();
        if (!entry) return false;

        setState((previous) => applyAction(previous, entry.redo));
        undoStackRef.current.push(entry);
        bumpVersion();
        return true;
    }, [applyAction, bumpVersion]);

    const clearHistory = useCallback(() => {
        undoStackRef.current = [];
        redoStackRef.current = [];
        bumpVersion();
    }, [bumpVersion]);

    return {
        state,
        setState,
        execute,
        record,
        undo,
        redo,
        clearHistory,
        canUndo: stackVersion >= 0 && undoStackRef.current.length > 0,
        canRedo: stackVersion >= 0 && redoStackRef.current.length > 0,
    };
}

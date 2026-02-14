import type { Station, Track } from '../routing';

interface TrackBuilderPanelProps {
    draftStartStation: Station | null;
    draftEndStation: Station | null;
    viaPointCount: number;
    currentDraftTrackObject: Track | null;
    savedDraftTracks: Track[];
    copyMessage: string | null;
    onResetDraft: () => void;
    onUndoPoint: () => void;
    onSaveTrack: () => void;
    onCopyCurrentJson: () => void;
    onCopySavedJson: () => void;
    onAppendSaved: () => void;
}

export function TrackBuilderPanel({
    draftStartStation,
    draftEndStation,
    viaPointCount,
    currentDraftTrackObject,
    savedDraftTracks,
    copyMessage,
    onResetDraft,
    onUndoPoint,
    onSaveTrack,
    onCopyCurrentJson,
    onCopySavedJson,
    onAppendSaved,
}: TrackBuilderPanelProps) {
    return (
        <div className="absolute bottom-4 left-4 z-30 w-[32rem] max-w-[92vw] bg-white/95 p-4 rounded shadow-md border border-amber-300">
            <p className="text-sm font-semibold text-gray-900">Track Builder</p>
            <p className="text-xs text-gray-700 mt-1">
                Click station marker 1 (start), station marker 2 (end), then click map to add points between them.
            </p>
            <p className="text-xs text-gray-700 mt-1">
                Start: {draftStartStation?.name ?? 'not selected'} | End: {draftEndStation?.name ?? 'not selected'} | Via points: {viaPointCount}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
                <button
                    onClick={onResetDraft}
                    className="rounded bg-gray-100 px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-200"
                >
                    Reset Draft
                </button>
                <button
                    onClick={onUndoPoint}
                    className="rounded bg-gray-100 px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-200"
                    disabled={viaPointCount === 0}
                >
                    Undo Point
                </button>
                <button
                    onClick={onSaveTrack}
                    className="rounded bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:bg-amber-300"
                    disabled={!currentDraftTrackObject}
                >
                    Save Track
                </button>
                <button
                    onClick={onCopyCurrentJson}
                    className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:bg-blue-300"
                    disabled={!currentDraftTrackObject}
                >
                    Copy Current JSON
                </button>
                <button
                    onClick={onCopySavedJson}
                    className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:bg-blue-300"
                    disabled={savedDraftTracks.length === 0}
                >
                    Copy Saved JSON
                </button>
                <button
                    onClick={onAppendSaved}
                    className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:bg-emerald-300"
                    disabled={savedDraftTracks.length === 0}
                >
                    Append Saved to tracks.json
                </button>
            </div>
            {copyMessage && (
                <p className="text-xs text-green-700 mt-2">{copyMessage}</p>
            )}
            {currentDraftTrackObject && (
                <textarea
                    className="mt-3 w-full h-36 text-xs font-mono p-2 border rounded"
                    readOnly
                    value={JSON.stringify(currentDraftTrackObject, null, 2)}
                />
            )}
            {savedDraftTracks.length > 0 && (
                <>
                    <p className="text-xs text-gray-700 mt-2">Saved tracks: {savedDraftTracks.length}</p>
                    <textarea
                        className="mt-2 w-full h-36 text-xs font-mono p-2 border rounded"
                        readOnly
                        value={JSON.stringify(savedDraftTracks, null, 2)}
                    />
                </>
            )}
        </div>
    );
}

import { ArrowsRightLeftIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { Station } from './routing';

export interface RouteDisplay {
    stationNames: string[];
    totalMinutes: number;
}

interface SearchBoxProps {
    stations: Station[];
    fromStationId: number | null;
    toStationId: number | null;
    routeDisplay: RouteDisplay | null;
    routeError: string | null;
    resetVersion: number;
    statusText?: string;
    onFromChange: (stationId: number | null) => void;
    onToChange: (stationId: number | null) => void;
    onSwap: () => void;
    onClear: () => void;
}

type FieldName = 'from' | 'to';

interface IndexedStation {
    station: Station;
    normalizedName: string;
    normalizedIata: string;
}

function normalizeQuery(value: string): string {
    return value.trim().toLowerCase();
}

function formatDuration(totalMinutes: number): string {
    const rounded = Math.round(totalMinutes);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;

    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

function getSuggestions(indexedStations: IndexedStation[], query: string, excludeId: number | null): Station[] {
    const normalizedQuery = normalizeQuery(query);
    const availableStations = indexedStations.filter(({ station }) => station.id !== excludeId);

    if (!normalizedQuery) {
        return availableStations
            .slice()
            .sort((a, b) => a.station.name.localeCompare(b.station.name))
            .slice(0, 8)
            .map(({ station }) => station);
    }

    return availableStations
        .map((entry) => {
            const { normalizedName, normalizedIata, station } = entry;
            const namePrefix = normalizedName.startsWith(normalizedQuery);
            const iataPrefix = normalizedIata.startsWith(normalizedQuery);
            const nameMatchIndex = normalizedName.indexOf(normalizedQuery);
            const iataMatchIndex = normalizedIata.indexOf(normalizedQuery);

            let rank = Number.POSITIVE_INFINITY;
            let matchIndex = Number.POSITIVE_INFINITY;

            if (namePrefix) {
                rank = 0;
                matchIndex = 0;
            } else if (iataPrefix) {
                rank = 1;
                matchIndex = 0;
            } else if (nameMatchIndex >= 0) {
                rank = 2;
                matchIndex = nameMatchIndex;
            } else if (iataMatchIndex >= 0) {
                rank = 3;
                matchIndex = iataMatchIndex;
            }

            if (!Number.isFinite(rank)) return null;

            return {
                station,
                rank,
                matchIndex,
            };
        })
        .filter((entry): entry is { station: Station; rank: number; matchIndex: number } => entry !== null)
        .sort((a, b) => (
            a.rank - b.rank ||
            a.matchIndex - b.matchIndex ||
            a.station.name.localeCompare(b.station.name)
        ))
        .slice(0, 8)
        .map(({ station }) => station);
}

export function SearchBox({
    stations,
    fromStationId,
    toStationId,
    routeDisplay,
    routeError,
    resetVersion,
    statusText,
    onFromChange,
    onToChange,
    onSwap,
    onClear,
}: SearchBoxProps) {
    const plannerRef = useRef<HTMLDivElement>(null);
    const fromInputRef = useRef<HTMLInputElement>(null);
    const toInputRef = useRef<HTMLInputElement>(null);
    const previousFromStationId = useRef<number | null>(fromStationId);
    const previousToStationId = useRef<number | null>(toStationId);
    const fromChangeSource = useRef<'typing' | null>(null);
    const toChangeSource = useRef<'typing' | null>(null);

    const [fromQuery, setFromQuery] = useState('');
    const [toQuery, setToQuery] = useState('');
    const [openField, setOpenField] = useState<FieldName | null>(null);
    const [highlightedIndex, setHighlightedIndex] = useState(0);

    const indexedStations = useMemo<IndexedStation[]>(
        () => stations.map((station) => ({
            station,
            normalizedName: normalizeQuery(station.name),
            normalizedIata: normalizeQuery(station.IATA),
        })),
        [stations]
    );

    const stationsById = useMemo(
        () => new Map(stations.map((station) => [station.id, station])),
        [stations]
    );

    const selectedFromStation = fromStationId === null ? null : stationsById.get(fromStationId) ?? null;
    const selectedToStation = toStationId === null ? null : stationsById.get(toStationId) ?? null;

    const fromSuggestions = useMemo(
        () => getSuggestions(indexedStations, fromQuery, toStationId),
        [indexedStations, fromQuery, toStationId]
    );

    const toSuggestions = useMemo(
        () => getSuggestions(indexedStations, toQuery, fromStationId),
        [indexedStations, fromStationId, toQuery]
    );

    const activeSuggestions = openField === 'from'
        ? fromSuggestions
        : openField === 'to'
            ? toSuggestions
            : [];

    const helperText = useMemo(() => {
        if (routeError || routeDisplay) return null;
        if (fromStationId !== null && toStationId === null) return 'Choose a destination city to preview the fastest route.';
        if (fromStationId === null && toStationId !== null) return 'Choose an origin city to preview the fastest route.';
        return statusText ?? 'Search by city name or airport code to find the fastest route.';
    }, [fromStationId, routeDisplay, routeError, statusText, toStationId]);

    const hasPlannerContent = fromQuery.length > 0 || toQuery.length > 0 || fromStationId !== null || toStationId !== null;
    const canSwap = fromStationId !== null && toStationId !== null;

    useEffect(() => {
        if (fromStationId === previousFromStationId.current) return;

        if (fromStationId !== null) {
            setFromQuery(stationsById.get(fromStationId)?.name ?? '');
        } else if (fromChangeSource.current !== 'typing') {
            setFromQuery('');
        }

        previousFromStationId.current = fromStationId;
        fromChangeSource.current = null;
    }, [fromStationId, stationsById]);

    useEffect(() => {
        if (toStationId === previousToStationId.current) return;

        if (toStationId !== null) {
            setToQuery(stationsById.get(toStationId)?.name ?? '');
        } else if (toChangeSource.current !== 'typing') {
            setToQuery('');
        }

        previousToStationId.current = toStationId;
        toChangeSource.current = null;
    }, [stationsById, toStationId]);

    useEffect(() => {
        setFromQuery('');
        setToQuery('');
        setOpenField(null);
        setHighlightedIndex(0);
    }, [resetVersion]);

    useEffect(() => {
        if (activeSuggestions.length === 0) {
            setHighlightedIndex(0);
            return;
        }

        setHighlightedIndex((current) => (
            current >= activeSuggestions.length ? 0 : current
        ));
    }, [activeSuggestions.length]);

    useEffect(() => {
        function handlePointerDown(event: PointerEvent) {
            if (!plannerRef.current?.contains(event.target as Node)) {
                setOpenField(null);
            }
        }

        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, []);

    const handleInputChange = (field: FieldName, value: string) => {
        setOpenField(field);
        setHighlightedIndex(0);

        if (field === 'from') {
            setFromQuery(value);
            if (fromStationId !== null) {
                fromChangeSource.current = 'typing';
                onFromChange(null);
            }
            return;
        }

        setToQuery(value);
        if (toStationId !== null) {
            toChangeSource.current = 'typing';
            onToChange(null);
        }
    };

    const handleSelectStation = (field: FieldName, station: Station) => {
        setOpenField(null);
        setHighlightedIndex(0);

        if (field === 'from') {
            setFromQuery(station.name);
            onFromChange(station.id);

            if (toStationId === null) {
                requestAnimationFrame(() => {
                    toInputRef.current?.focus();
                });
            }
            return;
        }

        setToQuery(station.name);
        onToChange(station.id);
    };

    const handleKeyDown = (field: FieldName, suggestions: Station[]) => (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (openField !== field) {
                setOpenField(field);
                setHighlightedIndex(0);
                return;
            }

            if (suggestions.length > 0) {
                setHighlightedIndex((current) => (current + 1) % suggestions.length);
            }
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (openField !== field) {
                setOpenField(field);
                setHighlightedIndex(0);
                return;
            }

            if (suggestions.length > 0) {
                setHighlightedIndex((current) => (
                    current === 0 ? suggestions.length - 1 : current - 1
                ));
            }
            return;
        }

        if (event.key === 'Enter') {
            if (openField === field && suggestions.length > 0) {
                event.preventDefault();
                handleSelectStation(field, suggestions[highlightedIndex] ?? suggestions[0]);
            }
            return;
        }

        if (event.key === 'Escape') {
            setOpenField(null);
            return;
        }

        if (event.key === 'Tab' && openField === field && suggestions.length > 0) {
            handleSelectStation(field, suggestions[highlightedIndex] ?? suggestions[0]);
        }
    };

    const handleClearClick = () => {
        setFromQuery('');
        setToQuery('');
        setOpenField(null);
        setHighlightedIndex(0);
        onClear();
    };

    const renderField = (
        field: FieldName,
        label: string,
        query: string,
        selectedStation: Station | null,
        suggestions: Station[],
        inputRef: RefObject<HTMLInputElement | null>,
    ) => {
        const isOpen = openField === field;
        const placeholder = field === 'from' ? 'Departure city' : 'Arrival city';
        const listId = `${field}-station-suggestions`;

        return (
            <div className="relative">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    {label}
                </label>
                <div
                    className={`rounded-2xl border bg-white/90 px-4 py-3 transition ${
                        isOpen
                            ? 'border-sky-500 shadow-[0_0_0_4px_rgba(14,165,233,0.12)]'
                            : 'border-slate-200 hover:border-slate-300'
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(event) => handleInputChange(field, event.target.value)}
                            onFocus={() => {
                                setOpenField(field);
                                setHighlightedIndex(0);
                            }}
                            onKeyDown={handleKeyDown(field, suggestions)}
                            placeholder={placeholder}
                            autoComplete="off"
                            spellCheck={false}
                            className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
                            role="combobox"
                            aria-expanded={isOpen}
                            aria-controls={listId}
                            aria-autocomplete="list"
                            aria-activedescendant={isOpen && suggestions[highlightedIndex]
                                ? `${field}-option-${suggestions[highlightedIndex].id}`
                                : undefined}
                        />
                        {selectedStation && (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                {selectedStation.IATA}
                            </span>
                        )}
                    </div>
                </div>
                {isOpen && (
                    <div className="absolute inset-x-0 top-[calc(100%_+_0.5rem)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.18)] backdrop-blur">
                        {suggestions.length > 0 ? (
                            <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-2">
                                {suggestions.map((station, index) => {
                                    const isHighlighted = index === highlightedIndex;

                                    return (
                                        <li key={station.id}>
                                            <button
                                                id={`${field}-option-${station.id}`}
                                                type="button"
                                                role="option"
                                                aria-selected={isHighlighted}
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => handleSelectStation(field, station)}
                                                className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition ${
                                                    isHighlighted ? 'bg-sky-50 text-sky-900' : 'text-slate-700 hover:bg-slate-50'
                                                }`}
                                            >
                                                <span className="font-medium">{station.name}</span>
                                                <span className="rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                                                    {station.IATA}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : (
                            <div className="px-4 py-4 text-sm text-slate-500">
                                No city or airport code matches that search.
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div
            ref={plannerRef}
            className="absolute left-4 top-4 z-20 w-[calc(100%_-_5.5rem)] max-w-[29rem]"
        >
            <section className="overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/85 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-xl">
                <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(14,165,233,0.10),rgba(255,255,255,0.35),rgba(16,185,129,0.12))] px-4 py-4 sm:px-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-sky-700">
                                Route Planner
                            </p>
                            <h2 className="mt-2 text-lg font-semibold text-slate-900">
                                Find the fastest trip between cities
                            </h2>
                            <p className="mt-1 text-sm text-slate-600">
                                Search by city name or airport code. Routes update as soon as both cities are selected.
                            </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                            <button
                                type="button"
                                onClick={onSwap}
                                disabled={!canSwap}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
                                    canSwap
                                        ? 'border-sky-200 bg-white/90 text-sky-700 hover:border-sky-300 hover:bg-white'
                                        : 'cursor-not-allowed border-slate-200 bg-white/60 text-slate-400'
                                }`}
                            >
                                <ArrowsRightLeftIcon className="h-4 w-4" />
                                Swap
                            </button>
                            <button
                                type="button"
                                onClick={handleClearClick}
                                disabled={!hasPlannerContent}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
                                    hasPlannerContent
                                        ? 'border-slate-200 bg-white/90 text-slate-600 hover:border-slate-300 hover:bg-white'
                                        : 'cursor-not-allowed border-slate-200 bg-white/60 text-slate-400'
                                }`}
                            >
                                <XMarkIcon className="h-4 w-4" />
                                Clear
                            </button>
                        </div>
                    </div>
                </div>

                <div className="space-y-4 px-4 py-4 sm:px-5">
                    {renderField('from', 'From', fromQuery, selectedFromStation, fromSuggestions, fromInputRef)}
                    {renderField('to', 'To', toQuery, selectedToStation, toSuggestions, toInputRef)}
                </div>

                <div className="border-t border-slate-200/80 bg-slate-50/85 px-4 py-4 sm:px-5">
                    {routeError && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {routeError}
                        </div>
                    )}
                    {!routeError && routeDisplay && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                            <div className="flex items-center justify-between gap-3">
                                <p className="font-semibold">Estimated travel time</p>
                                <p className="text-base font-semibold">{formatDuration(routeDisplay.totalMinutes)}</p>
                            </div>
                            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
                                Route
                            </p>
                            <p className="mt-1 text-sm leading-6 text-emerald-950">
                                {routeDisplay.stationNames.join(' -> ')}
                            </p>
                        </div>
                    )}
                    {!routeError && !routeDisplay && helperText && (
                        <p className="text-sm leading-6 text-slate-600">
                            {helperText}
                        </p>
                    )}
                </div>
            </section>
        </div>
    );
}

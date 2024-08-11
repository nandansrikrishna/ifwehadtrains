import React, { useState } from 'react';

interface Station {
    id: number;
    name: string;
    lngLat: [number, number];
}

interface SearchBoxProps {
    onSearch: (from: number, to: number) => void;
    stations: Station[];
}

export function SearchBox({ onSearch, stations }: SearchBoxProps) {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [fromSuggestions, setFromSuggestions] = useState<Station[]>([]);
    const [toSuggestions, setToSuggestions] = useState<Station[]>([]);
    const [selectedFromStation, setSelectedFromStation] = useState<Station | null>(null);
    const [selectedToStation, setSelectedToStation] = useState<Station | null>(null);

    const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setFrom(value);
        if (value) {
            setFromSuggestions(
                stations.filter((station) =>
                    station.name.toLowerCase().includes(value.toLowerCase())
                )
            );
        } else {
            setFromSuggestions([]);
        }
    };

    const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setTo(value);
        if (value) {
            setToSuggestions(
                stations.filter((station) =>
                    station.name.toLowerCase().includes(value.toLowerCase())
                )
            );
        } else {
            setToSuggestions([]);
        }
    };

    const handleFromSelect = (station: Station) => {
        setSelectedFromStation(station);
        setFrom(station.name);
        setFromSuggestions([]);
    };

    const handleToSelect = (station: Station) => {
        setSelectedToStation(station);
        setTo(station.name);
        setToSuggestions([]);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedFromStation && selectedToStation) {
            onSearch(selectedFromStation.id, selectedToStation.id);
        } else {
            // Handle case where user didn't select from the dropdown
            alert('Please select valid stations from the suggestions.');
        }
    };

    return (
        <form onSubmit={handleSubmit} className="absolute top-4 left-4 transform z-10 bg-white p-4 rounded shadow-md">
            <div className="mb-2">
                <input
                    type="text"
                    value={from}
                    onChange={handleFromChange}
                    placeholder="From"
                    className="w-full p-2 border rounded"
                />
                {fromSuggestions.length > 0 && (
                    <ul className="absolute bg-white border rounded shadow-md mt-1 w-full max-h-40 overflow-y-auto">
                        {fromSuggestions.map((station) => (
                            <li
                                key={station.id}
                                onClick={() => handleFromSelect(station)}
                                className="p-2 cursor-pointer hover:bg-gray-200"
                            >
                                {station.name}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="mb-2">
                <input
                    type="text"
                    value={to}
                    onChange={handleToChange}
                    placeholder="To"
                    className="w-full p-2 border rounded"
                />
                {toSuggestions.length > 0 && (
                    <ul className="absolute bg-white border rounded shadow-md mt-1 w-full max-h-40 overflow-y-auto">
                        {toSuggestions.map((station) => (
                            <li
                                key={station.id}
                                onClick={() => handleToSelect(station)}
                                className="p-2 cursor-pointer hover:bg-gray-200"
                            >
                                {station.name}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <button type="submit" className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
                Search Route
            </button>
        </form>
    );
}

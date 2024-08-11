import React, { useState } from 'react';

interface SearchBoxProps {
    onSearch: (from: string, to: string) => void;
}

export function SearchBox({ onSearch }: SearchBoxProps) {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSearch(from, to);
    };

    return (
        <form onSubmit={handleSubmit} className="absolute top-4 left-4 transform z-10 bg-white p-4 rounded shadow-md">
            <div className="mb-2">
                <input
                    type="text"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    placeholder="From"
                    className="w-full p-2 border rounded"
                />
            </div>
            <div className="mb-2">
                <input
                    type="text"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="To"
                    className="w-full p-2 border rounded"
                />
            </div>
            <button type="submit" className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
                Search Route
            </button>
        </form>
    );
}
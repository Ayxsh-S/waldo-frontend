import React, { useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

function formatMs(ms) {
    if (ms === null) return "00:00.00";
    const totalSeconds = Math.floor(ms/1000);
    const minutes = Math.floor(totalSeconds/60);
    const seconds = totalSeconds%60;
    const tenths = Math.floor((ms%1000)/100);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function getNormalisedClick(e, imgEl) {
    const rect = imgEl.getBoundingClientRect();
    return {
        xNorm: (e.clientX-rect.left)/rect.width,
        yNorm: (e.clientY-rect.top)/rect.height
    };
}

export default function App() {
    const imgRef = useRef(null);
    const boardRef = useRef(null);
    const timerRef = useRef(null);

    const [photos, setPhotos] = useState([]);
    const [photo, setPhoto] = useState(null);

    const [sessionToken, setSessionToken] = useState(null);
    const [startedAt, setStartedAt] = useState(null);
    const [completedAt, setCompletedAt] = useState(null);

    const [characters, setCharacters] = useState([]);
    const [foundMarkers, setFoundMarkers] = useState([]);
    const [foundIds, setFoundIds] = useState([]);

    const [clickPoint, setClickPoint] = useState(null);
    const [selectedCharacterId, setSelectedCharacterId] = useState("");
    const [guessMessage, setGuessMessage] = useState("");
    const [guessClass, setGuessClass] = useState("");

    const [elapsedMs, setElapsedMs] = useState(0);
    const [finalScoreMs, setFinalScoreMs] = useState(null);

    const [highscores, setHighScores] = useState([]);

    const [nameModalOpen, setNameModalOpen] = useState(false);
    const [playerName, setPlayerName] = useState("");

    const apiFetch = async (path, options = {}) => {
        const res = await fetch(`${API_URL}${path}`, {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            },
            ...options
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || "Request failed");
        }
        return data;
    };

    const currentCharacters = useMemo(() => {
        return characters.filter((c) => !foundIds.includes(c.id));
    }, [characters, foundIds]);

    async function loadPhotos() {
        const data = await apiFetch("/api/game/photos");
        setPhotos(data.photos);
        if (data.photos.length > 0) {
            setPhoto(data.photos[0]);
        }
    }

    async function loadHighScores(photoId) {
        const data = await apiFetch(`/api/game/high-scores?photoId=${photoId}`);
        setHighScores(data.scores);
    }

    async function startOrResumeSession(nextPhoto) {
        if (!nextPhoto) return;
        const storageKey = `photo-tag-session:${nextPhoto.id}`;
        const existingToken = localStorage.getItem(storageKey);

        setFoundMarkers([]);
        setFoundIds([]);
        setGuessMessage("");
        setGuessClass("");
        setFinalScoreMs(null);
        setCompletedAt(null);
        setNameModalOpen(false);
        setPlayerName("");

        if (existingToken) {
            try {
                const sessionData = await apiFetch(`/api/game/sessions/${existingToken}`);
                setSessionToken(sessionData.session.sessionToken);
                setStartedAt(sessionData.session.startedAt);
                setCompletedAt(sessionData.session.completedAt);
                setCharacters(sessionData.photo.characters);
                setFoundMarkers(
                    sessionData.session.foundCharacters.map((c) => ({
                        id: c.id,
                        xNorm: c.xNorm,
                        yNorm: c.yNorm,
                        name: c.name
                    }))
                );
                setFoundIds(sessionData.session.foundCharacters.map((c) => c.id));
                if (sessionData.session.scoreMs != null) {
                    setFinalScoreMs(sessionData.session.scoreMs);
                }
                await loadHighScores(nextPhoto.id);
                return;
            } catch {
                localStorage.removeItem(storageKey);
            }
        }
        const photoData = await apiFetch(`/api/game/photos/${nextPhoto.id}`);
        setCharacters(photoData.photo.characters);

        const startData = await apiFetch("/api/game/sessions/start", {
            method: "POST",
            body: JSON.stringify({ photoId: nextPhoto.id })
        });

        localStorage.setItem(storageKey, startData.sessionToken);
        setSessionToken(startData.sessionToken);
        setStartedAt(startData.startedAt);
        setHighScores([]);
        await loadHighScores(nextPhoto.id);
    }
    
    useEffect(() => {
        loadPhotos().catch((err) => setGuessMessage(err.message));
    }, []);

    useEffect(() => {
        if (!photo) return;
        startOrResumeSession(photo).catch((err) => setGuessMessage(err.message));
    }, [photo]);

    useEffect(() => {
        if (!startedAt || completedAt) return;

        timerRef.current = window.setInterval(() => {
            setElapsedMs(Date.now() - new Date(startedAt).getTime());
        }, 250);

        return () => window.clearInterval(timerRef.current);
    }, [startedAt, completedAt]);

    useEffect(() => {
        if (startedAt && !completedAt) {
            setElapsedMs(Date.now() - new Date(startedAt).getTime());
        }
        if (completedAt && finalScoreMs != null) {
            setElapsedMs(finalScoreMs);
        }
    }, [startedAt, completedAt, finalScoreMs]);

    useEffect(() => {
        const handleDocClick = (e) => {
            if (!boardRef.current) return;
            if (!clickPoint) return;
            if (!boardRef.current.contains(e.target)) {
                setClickPoint(null);
                setSelectedCharacterId("");
            }
        };

        document.addEventListener("mousedown", handleDocClick);
        return () => document.removeEventListener("mousedown", handleDocClick);
    }, [clickPoint]);

    function handleImageClick(e) {
        if (!imgRef.current || !boardRef.current) return;
        if (completedAt) return;

        const { xNorm, yNorm } = getNormalisedClick(e, imgRef.current);
        if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1) return;

        setClickPoint({ xNorm, yNorm });
        setSelectedCharacterId("");
        setGuessMessage("");
        setGuessClass("");
        console.log(xNorm, yNorm);
    }

    async function handleGuess() {
        if (!clickPoint || !selectedCharacterId || !photo || !sessionToken) return;

        try {
            const data = await apiFetch("/api/game/guesses/validate", {
                method: "POST",
                body: JSON.stringify({
                    sessionToken,
                    photoId: photo.id,
                    characterId: selectedCharacterId,
                    xNorm: clickPoint.xNorm,
                    yNorm: clickPoint.yNorm
                })
            });

            if (!data.correct) {
                setGuessMessage(data.message || "Wrong spot");
                setGuessClass("");
                setClickPoint(null);
                setSelectedCharacterId("");
                return;
            }

            if (!data.alreadyFound) {
                setFoundMarkers((prev) => [
                    ...prev,
                    {
                        id: data.character.id,
                        xNorm: data.character.xNorm,
                        yNorm: data.character.yNorm,
                        name: data.character.name
                    }
                ]);
                setFoundIds((prev) => [...prev, data.character.id]);
            }

            setGuessMessage(`${data.character.name} found!`);
            setGuessClass("success");
            setClickPoint(null);
            setSelectedCharacterId("");

            if (data.completed) {
                setCompletedAt(new Date().toISOString());
                setFinalScoreMs(data.scoreMs);
                setNameModalOpen(true);
            }
        } catch (err) {
            setGuessMessage(err.message);
            setGuessClass("");
        }
    }

    async function handleSaveName(e) {
        e.preventDefault();
        if (!sessionToken || !playerName.trim()) return;

        try {
            await apiFetch("/api/game/sessions/finish", {
                method: "POST", 
                body: JSON.stringify({
                    sessionToken,
                    playerName
                })
            });

            setNameModalOpen(false);
            await loadHighScores(photo.id);
        } catch (err) {
            setGuessMessage(err.message);
        }
    }

    function handlePhotoChange(e) {
        const next = photos.find((p) => String(p.id) === e.target.value);
        if (next) setPhoto(next);
    }

    return (
        <div className="app">
            <div className="header">
                <div>
                    <h1 className="title">Where's Waldo</h1>
                    <div className="subtle">Click the image, choose a character and tag he all.</div>
                </div>
                <div className="panel">
                    <div>Time</div>
                    <div style={{ fontSize: 24, fontWeight: 800 }}>{formatMs(elapsedMs)}</div>
                </div>
            </div>
            <div className="controls panel">
                <label>
                    <div className="subtle" style={{ marginBottom: 6 }}>
                        Choose image
                    </div>
                    <select value={photo?.id || ""} onChange={handlePhotoChange}>
                        {photos.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.title}
                            </option>
                        ))}
                    </select>
                </label>
                <button 
                    className="secondary"
                    onClick={() => {
                        if (photo) startOrResumeSession(photo);
                    }}
                >
                    Restart round
                </button>
                
                <div className="subtle">
                    Found {foundIds.length}/{characters.length}
                </div>
            </div>

            <div className="game-layout">
                <div className="panel">
                    <div 
                        ref={boardRef}
                        className="board"
                        onClick={handleImageClick}
                        style={{ cursor: completedAt ? "default" : "crosshair" }}
                    >
                        {photo && (
                            <img 
                                ref={imgRef}
                                src={photo.imageUrl}
                                alt={photo.title}
                                draggable="false"
                            />
                        )}

                        {foundMarkers.map((marker) => (
                            <div 
                                key={marker.id}
                                className="marker"
                                style={{ 
                                    left: `${marker.xNorm*100}%`,
                                    top: `${marker.yNorm*100}%`
                                }}
                                title={marker.name}
                            />
                        ))}
                        {clickPoint && !completedAt && (
                            <>
                                <div
                                    className="target-box"
                                    style={{
                                        left: `${clickPoint.xNorm*100}%`,
                                        top: `${clickPoint.yNorm*100}%`
                                    }}
                                />
                                <div
                                    className="dropdown"
                                    style={{
                                        left: `${Math.min(clickPoint.xNorm*100+4, 78)}%`,
                                        top: `${Math.min(clickPoint.yNorm*100+4, 78)}%`
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div style={{ marginBottom: 8, fontWeight: 700 }}>Who?</div>
                                    <select
                                        value={selectedCharacterId}
                                        onChange={(e) => setSelectedCharacterId(e.target.value)}
                                    >
                                        <option value="">Select character</option>
                                        {currentCharacters.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                        <button onClick={handleGuess} disabled={!selectedCharacterId}>
                                            Check {/* change as neccessary */}
                                        </button>
                                        <button 
                                            className="secondary"
                                            onClick={() => {
                                                setClickPoint(null);
                                                setSelectedCharacterId("");
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                    <div className={`feedback ${guessClass}`}>{guessMessage}</div>
                </div>
                <div className="panel sidebar-card">
                    <div>
                        <div className="subtle">Characters left</div>
                        <div className="list">
                            {currentCharacters.map((c) => (
                                <div key={c.id} className="list-item">
                                    {c.name}
                                </div>
                            ))}
                            {currentCharacters.length === 0 && <div className="list-item">All found!</div>}
                        </div>
                    </div>

                    <div>
                        <div className="subtle">High scores</div>
                        <div className="list">
                            {highscores.length === 0 && <div className="list-item">No scores yet</div>}
                            {highscores.map((score, index) => (
                                <div key={`${score.playerName}-${score.scoreMs}`} className="list-item">
                                    <strong>{index+1}.</strong>{score.playerName} - {formatMs(score.scoreMs)}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            {nameModalOpen && (
                <div className="modal-backdrop">
                    <div className="modal">
                        <h2 style={{ marginTop: 0 }}>You found everyone!</h2>
                        <p className="subtle">Your time: <strong>{formatMs(finalScoreMs)}</strong></p>

                        <form onSubmit={handleSaveName} style={{ display: "grid", gap: 12 }}>
                            <input 
                                value={playerName}
                                onChange={(e) => setPlayerName(e.target.value)}
                                placeholder="Enter your name"
                            />
                            <button type="submit">Save score</button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
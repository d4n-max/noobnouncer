import { Grid } from "@giphy/react-components";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { getSelectedGif, type SelectedGif } from "./giphy";

type GiphyPickerModalProps = {
  apiKey: string;
  onClose: () => void;
  onSelect: (gif: SelectedGif) => void;
};

const GIF_LIMIT = 24;

export function GiphyPickerModal({ apiKey, onClose, onSelect }: GiphyPickerModalProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [gridWidth, setGridWidth] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);
  const giphyFetch = useMemo(() => new GiphyFetch(apiKey), [apiKey]);
  const normalizedQuery = debouncedQuery.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim().length >= 2 ? query.trim() : "");
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const element = resultsRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setIsLoading(true);
    setLoadError("");
  }, [normalizedQuery]);

  const fetchGifs = useCallback(
    (offset: number) =>
      normalizedQuery
        ? giphyFetch.search(normalizedQuery, { limit: GIF_LIMIT, offset, rating: "pg-13" })
        : giphyFetch.trending({ limit: GIF_LIMIT, offset, rating: "pg-13" }),
    [giphyFetch, normalizedQuery]
  );

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDebouncedQuery(query.trim().length >= 2 ? query.trim() : "");
  }

  function handleFetchError(error: Error) {
    setIsLoading(false);
    const status = "status" in error ? Number(error.status) : 0;
    setLoadError(status === 429 ? "GIPHY request limit reached. Try again later." : "Could not load GIFs. Please try again.");
  }

  const columns = gridWidth < 460 ? 2 : 3;

  return (
    <div className="giphy-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="giphy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="giphy-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="giphy-modal-header">
          <h2 id="giphy-picker-title">Choose a GIF</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close GIF picker" title="Close GIF picker">
            <X />
          </button>
        </header>
        <form className="giphy-search" onSubmit={handleSearch}>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search GIFs"
            aria-label="Search GIFs"
          />
        </form>
        <div className="giphy-results" ref={resultsRef} aria-busy={isLoading}>
          {isLoading && <p className="giphy-state">Loading GIFs...</p>}
          {loadError && <p className="giphy-error">{loadError}</p>}
          {gridWidth > 0 && !loadError && (
            <Grid
              key={normalizedQuery || "trending"}
              width={gridWidth}
              columns={columns}
              gutter={8}
              user={{}}
              fetchGifs={fetchGifs}
              noLink
              borderRadius={6}
              noResultsMessage="No GIFs found."
              onGifsFetched={() => setIsLoading(false)}
              onGifsFetchError={handleFetchError}
              onGifClick={(gif) => onSelect(getSelectedGif(gif))}
            />
          )}
        </div>
        <footer className="giphy-attribution">Powered by GIPHY</footer>
      </section>
    </div>
  );
}

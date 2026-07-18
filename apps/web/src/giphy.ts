export type SelectedGif = {
  url: string;
  id: string;
  title: string;
};

type GiphyGif = {
  id: string | number;
  title: string;
  alt_text?: string;
  images: { original: { url: string } };
};

export function getSelectedGif(gif: GiphyGif): SelectedGif {
  return {
    url: gif.images.original.url,
    id: String(gif.id),
    title: gif.title || gif.alt_text || "Selected GIF"
  };
}

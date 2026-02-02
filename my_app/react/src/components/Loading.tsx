import "../styles/loading.css";

export function Loading() {
  return (
    <div className="loading-container-centered">
      <h1>
        L O A D I N G<span className="dot dot-1">.</span>
        <span className="dot dot-2">.</span>
        <span className="dot dot-3">.</span>
      </h1>
      <div className="status-message-box">
        <div className="bank merriweather">Due to the discontinuation of Render's free hosting tier, this website is unavailable as of February 2, 2026.</div>
        <div className="bank merriweather">I am currently looking for new hosting alternatives.</div>
      </div>
    </div>
  );
}

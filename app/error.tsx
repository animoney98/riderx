'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="login">
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h1 style={{ fontSize: 24 }}>Something went wrong</h1>
        <p className="note">Please try again. If it keeps happening, send RiderX this code: {error.digest ?? 'none'}</p>
        <button type="button" onClick={() => reset()}>Try again</button>
        <a href="/rider-login">Back to sign in</a>
      </div>
    </main>
  );
}

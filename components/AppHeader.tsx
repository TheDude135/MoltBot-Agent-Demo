// The app header: brand mark, title, and one-line description. Static, so it
// lives apart from the stateful orchestrator in app/page.tsx.

export function AppHeader() {
  return (
    <header className="mb-6 flex items-center gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 shadow-lg shadow-violet-700/30">
          <span className="text-2xl leading-none" role="img" aria-label="Friendly robot">
            🤖
          </span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-white">
              Agent Deploy
            </h1>
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
              Demo
            </span>
          </div>
          <p className="text-xs text-gray-500">
            Using the MoltBot Ninja API to deploy a new AI agent from a blueprint.
          </p>
        </div>
      </div>
    </header>
  );
}

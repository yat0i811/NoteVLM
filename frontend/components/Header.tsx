interface HeaderProps {
  onToggleSidebar: () => void;
}

export default function Header({ onToggleSidebar }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="group flex items-center gap-3 rounded-lg px-2 py-1 text-left transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
        aria-label="Toggle sidebar"
      >
        <div>
          <h1 className="text-lg font-semibold text-primary group-hover:text-primary/80">NoteVLM</h1>
        </div>
      </button>
    </header>
  );
}

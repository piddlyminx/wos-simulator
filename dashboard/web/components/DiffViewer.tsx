"use client";

function DiffLine({ line }: { line: string }) {
  let color = "inherit";
  if (line.startsWith("+")) color = "#a6e3a1";
  else if (line.startsWith("-")) color = "#f38ba8";
  else if (line.startsWith("@@")) color = "#89dceb";

  return (
    <div style={{ color }} className="font-mono text-xs leading-relaxed">
      {line}
    </div>
  );
}

export { DiffLine };

export default function DiffViewer({ patch }: { patch: string }) {
  return (
    <pre className="text-xs leading-relaxed overflow-x-auto whitespace-pre">
      {patch.split("\n").map((line, i) => (
        <DiffLine key={i} line={line} />
      ))}
    </pre>
  );
}

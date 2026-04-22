export function Button({ children }: { children: React.ReactNode }) {
  return (
    <button style={{ padding: "10px", background: "black", color: "white" }}>
      {children}
    </button>
  );
}
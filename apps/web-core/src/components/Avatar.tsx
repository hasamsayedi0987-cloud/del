import { AVATAR_COLORS } from "../store";

export function Avatar({
  name,
  color,
  size = 48,
  online,
}: {
  name: string;
  color: number;
  size?: number;
  online?: boolean;
}) {
  const initial = (name || "؟").trim().charAt(0);
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, ${AVATAR_COLORS[color % AVATAR_COLORS.length]}, ${
          AVATAR_COLORS[(color + 2) % AVATAR_COLORS.length]
        })`,
      }}
    >
      {initial}
      {online && <span className="dot" />}
    </div>
  );
}

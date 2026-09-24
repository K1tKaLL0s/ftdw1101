import Image from "next/image";

export function UserAvatar(props: { userId: string; version: number; name: string; size?: number }) {
  const size = props.size ?? 48;
  const source = props.version > 0
    ? `/api/users/${encodeURIComponent(props.userId)}/avatar?v=${props.version}`
    : "/default-avatar.png";
  return <Image
    src={source}
    alt={`${props.name}的头像`}
    width={size}
    height={size}
    unoptimized
    className="shrink-0 rounded-full bg-slate-100 object-cover"
    style={{ width: size, height: size }}
    onError={(event) => {
      event.currentTarget.onerror = null;
      event.currentTarget.src = "/default-avatar.png";
    }}
  />;
}

export function BrandMark({ className = 'size-7' }: { className?: string }) {
  return (
    <img
      src="/favicon.svg"
      alt=""
      width={28}
      height={28}
      className={`shrink-0 ${className}`}
    />
  );
}

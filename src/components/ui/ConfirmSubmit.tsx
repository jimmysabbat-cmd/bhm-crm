"use client";

export function ConfirmSubmitButton({
  label,
  confirmMessage,
  className,
}: {
  label: string;
  confirmMessage: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {label}
    </button>
  );
}

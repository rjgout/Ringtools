"use client";

/** Submit-knop die eerst om bevestiging vraagt (bijvoorbeeld voor een ingrijpende, maar omkeerbare actie). */
export function ConfirmSubmitButton({
  children,
  message,
  className,
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

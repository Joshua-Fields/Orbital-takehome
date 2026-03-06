import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface DropDownOption {
	id: string;
	label: string;
}

interface DropDownProps {
	options: DropDownOption[];
	selectedId: string;
	onSelect: (id: string) => void;
	className?: string;
}

export function DropDown({
	options,
	selectedId,
	onSelect,
	className,
}: DropDownProps) {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const selected =
		options.find((option) => option.id === selectedId) ?? options[0] ?? null;

	useEffect(() => {
		if (!open) return;

		const handleClickOutside = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setOpen(false);
			}
		};

		window.addEventListener("mousedown", handleClickOutside);

		return () => {
			window.removeEventListener("mousedown", handleClickOutside);
		};
	}, [open]);

	if (!selected) return null;

	return (
		<div ref={containerRef} className={`relative w-full ${className ?? ""}`}>
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				className="flex w-full items-center justify-between rounded border border-neutral-200 bg-white px-2 py-1 text-sm text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 focus-visible:ring-offset-1"
				aria-haspopup="listbox"
				aria-expanded={open}
			>
				<span className="truncate">{selected.label}</span>
				<ChevronDown
					className={`ml-2 h-4 w-4 flex-shrink-0 text-neutral-400 transition-transform ${
						open ? "rotate-180" : ""
					}`}
				/>
			</button>

			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, y: -4, scale: 0.98 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -2, scale: 0.98 }}
						transition={{ duration: 0.12, ease: "easeOut" }}
						className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg"
						role="listbox"
					>
						{options.map((option) => (
							<button
								key={option.id}
								type="button"
								onClick={() => {
									onSelect(option.id);
									setOpen(false);
								}}
								className={`flex w-full items-center px-2 py-1.5 text-left text-neutral-800 transition-colors hover:bg-neutral-50 ${
									option.id === selected.id ? "bg-neutral-50 font-medium" : ""
								}`}
								role="option"
								aria-selected={option.id === selected.id}
							>
								<span className="truncate">{option.label}</span>
							</button>
						))}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}


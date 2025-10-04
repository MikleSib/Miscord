import * as React from 'react';

export interface RadioGroupProps {
	value?: string;
	onValueChange?: (value: string) => void;
	children?: React.ReactNode;
	className?: string;
}

const RadioGroupContext = React.createContext<{
	value: string | undefined;
	onChange: (value: string) => void;
} | null>(null);

export const RadioGroup: React.FC<RadioGroupProps> = ({ value, onValueChange, children, className = '' }) => {
	const handleChange = React.useCallback((val: string) => {
		onValueChange?.(val);
	}, [onValueChange]);

	return (
		<div role="radiogroup" className={className}>
			<RadioGroupContext.Provider value={{ value, onChange: handleChange }}>
				{children}
			</RadioGroupContext.Provider>
		</div>
	);
};

export interface RadioGroupItemProps extends React.InputHTMLAttributes<HTMLInputElement> {
	id: string;
	value: string;
	className?: string;
}

export const RadioGroupItem = React.forwardRef<HTMLInputElement, RadioGroupItemProps>(
	({ id, value, className = '', disabled, ...props }, ref) => {
		const ctx = React.useContext(RadioGroupContext);
		const checked = ctx?.value === value;

		return (
			<input
				ref={ref}
				type="radio"
				role="radio"
				id={id}
				value={value}
				checked={checked}
				disabled={disabled}
				onChange={() => ctx?.onChange(value)}
				className={`h-4 w-4 border border-gray-300 rounded-full text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
				{...props}
			/>
		);
	}
);

RadioGroupItem.displayName = 'RadioGroupItem';

export default RadioGroup;





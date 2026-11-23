// shadcn/ui button (base-nova, Base UI), restyled with the brand's .btn shapes from globals.css.
// Admin only: the public site keeps its own hand-written buttons (eslint.config.mjs enforces it).
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // .btn: pill shape, padding, weight and press feedback. 44 px is the minimum touch height.
  "btn min-h-11 select-none disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        default: "btn-forest",
        outline: "btn-outline text-forest",
        destructive: "bg-destructive text-ivory hover:bg-destructive/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, className }))} {...props} />;
}

export { Button, buttonVariants };

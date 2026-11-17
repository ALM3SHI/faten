"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "إلغاء",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-5 p-6 sm:max-w-md shadow-card"
        dir="rtl"
        showCloseButton={false}
      >
        <DialogHeader className="gap-3 text-right sm:text-right">
          <DialogTitle
            className={cn(
              "text-subheading font-bold leading-snug text-ink",
              destructive && "text-danger-ink ",
            )}
          >
            {title}
          </DialogTitle>
          <DialogDescription className="text-small leading-relaxed text-ink-muted">
            {description}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-row items-center justify-start gap-3 border-0 bg-transparent p-0 -mx-0 -mb-0 rounded-none sm:justify-start">
          <Button
            type="button"
            variant="default"
            className={cn(
              "h-10 min-w-[5rem] px-5 rounded-control text-small font-bold",
              destructive &&
                "border border-danger-line bg-danger-soft text-danger-ink hover:border-danger-ink",
            )}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 min-w-[5rem] px-5 rounded-control text-small font-medium bg-surface border-line text-ink hover:bg-surface-sunken hover:text-ink"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

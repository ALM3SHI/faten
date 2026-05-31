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
        className="gap-5 p-6 sm:max-w-md shadow-2xl"
        dir="rtl"
        showCloseButton={false}
      >
        <DialogHeader className="gap-3 text-right sm:text-right">
          <DialogTitle
            className={cn(
              "text-lg font-bold leading-snug text-foreground",
              destructive && "text-red-600 dark:text-red-400",
            )}
          >
            {title}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-row items-center justify-start gap-3 border-0 bg-transparent p-0 -mx-0 -mb-0 rounded-none sm:justify-start">
          <Button
            type="button"
            variant="default"
            className={cn(
              "h-10 min-w-[5rem] px-5 rounded-xl text-sm font-bold",
              destructive &&
                "bg-red-600 text-white hover:bg-red-700 border-red-600 shadow-md shadow-red-900/20 dark:bg-red-600 dark:hover:bg-red-500 dark:shadow-red-900/25",
            )}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 min-w-[5rem] px-5 rounded-xl text-sm font-medium bg-background border-border text-foreground hover:bg-secondary/80 hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

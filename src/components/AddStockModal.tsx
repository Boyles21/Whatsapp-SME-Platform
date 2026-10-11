import React, { useState } from 'react';
import { X, Package, AlertCircle } from 'lucide-react';
import { Product } from '../types.ts';

interface AddStockModalProps {
  isOpen: boolean;
  product: Product | null;
  onClose: () => void;
  onStockAdded: () => void;
  currencySymbol: string;
}

export const AddStockModal: React.FC<AddStockModalProps> = ({
  isOpen,
  product,
  onClose,
  onStockAdded,
  currencySymbol,
}) => {
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState(product ? String(product.costPrice) : '');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !product) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setError('Quantity to add must be a positive number greater than 0.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch('/api/inventory/stock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          quantity: qty,
          unitCost: unitCost ? parseFloat(unitCost) : undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add stock');
      }

      onStockAdded();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full max-h-[92dvh] flex flex-col overflow-hidden border border-gray-100 my-auto animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 bg-emerald-800 text-white shrink-0">
          <div className="flex items-center gap-2 font-semibold text-sm sm:text-base">
            <Package className="w-5 h-5 text-emerald-300 shrink-0" />
            <span className="truncate">Add Stock: {product.name}</span>
          </div>
          <button
            onClick={onClose}
            className="text-emerald-200 hover:text-white p-1 rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="flex items-center gap-2 p-3 text-xs bg-red-50 text-red-700 rounded-lg border border-red-200">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-xs flex justify-between items-center">
            <div>
              <span className="text-gray-500 block">Current Stock:</span>
              <span className="font-bold text-gray-900 text-sm">{product.currentStock} {product.unit}(s)</span>
            </div>
            <div className="text-right">
              <span className="text-gray-500 block">SKU:</span>
              <span className="font-mono text-gray-700">{product.sku}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Quantity to Add ({product.unit}s) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              required
              min="1"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 50"
              autoFocus
              className="w-full text-base sm:text-sm px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Cost Price per Unit ({currencySymbol})
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder={String(product.costPrice)}
              className="w-full text-base sm:text-sm px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Notes / Reference (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Batch received from supplier"
              className="w-full text-base sm:text-sm px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 rounded-lg transition-colors min-h-[40px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-50 rounded-lg shadow-sm transition-colors min-h-[40px]"
            >
              {isSubmitting ? 'Adding...' : 'Confirm Stock In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

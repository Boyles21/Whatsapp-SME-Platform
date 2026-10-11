import React, { useState, useEffect } from 'react';
import { 
  Package, 
  DollarSign, 
  TrendingUp, 
  AlertTriangle, 
  Plus, 
  ArrowDownLeft, 
  ArrowUpRight, 
  ShieldCheck, 
  Search, 
  RefreshCw,
  ShoppingBag,
  Layers,
  LayoutGrid,
  Table as TableIcon
} from 'lucide-react';
import { DashboardData, Product, InventoryTransaction, Sale, AuditLog } from '../types.ts';

interface DashboardViewProps {
  data: DashboardData | null;
  products: Product[];
  transactions: InventoryTransaction[];
  sales: Sale[];
  auditLogs: AuditLog[];
  isLoading: boolean;
  onRefresh: () => void;
  onOpenCreateProduct: () => void;
  onOpenAddStock: (product: Product) => void;
  activeTab?: 'products' | 'transactions' | 'sales' | 'audit';
  onTabChange?: (tab: 'products' | 'transactions' | 'sales' | 'audit') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  products,
  transactions,
  sales,
  auditLogs,
  isLoading,
  onRefresh,
  onOpenCreateProduct,
  onOpenAddStock,
  activeTab: controlledActiveTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<'products' | 'transactions' | 'sales' | 'audit'>('products');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(false);
  const [mobileDisplayMode, setMobileDisplayMode] = useState<'cards' | 'table'>('cards');

  const activeTab = controlledActiveTab || internalTab;
  const setActiveTab = (tab: 'products' | 'transactions' | 'sales' | 'audit') => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  const currencySymbol = data?.currencySymbol || '₦';

  // Filter products
  const filteredProducts = products.filter(p => {
    const matchesSearch = 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLowStock = filterLowStockOnly ? p.currentStock <= (p.minStockLevel || 0) : true;
    return matchesSearch && matchesLowStock;
  });

  return (
    <div id="dashboard-container" className="flex flex-col h-full bg-gray-50 overflow-y-auto">
      {/* Dashboard Header Bar */}
      <div className="bg-white border-b border-gray-200 px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sticky top-0 z-10 shadow-2xs">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span>SME Inventory & Sales Center</span>
            <span className="text-[10px] sm:text-xs bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded-full whitespace-nowrap">
              Live Sync
            </span>
          </h1>
          <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">
            Real-time atomic inventory tracking, automated audit trail, and instant WhatsApp assistant integration.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 active:bg-gray-100 border border-gray-300 rounded-lg shadow-2xs transition-colors min-h-[38px]"
            title="Refresh database state"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-600' : 'text-gray-500'}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={onOpenCreateProduct}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 rounded-lg shadow-xs transition-colors min-h-[38px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        {/* The 4 Core Dashboard Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
          {/* Card 1: Total Products */}
          <div className="bg-white rounded-xl p-3 sm:p-4 border border-gray-200 shadow-2xs flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider block truncate">
                Total Products
              </span>
              <span className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-gray-900 mt-0.5 sm:mt-1 block">
                {data ? data.totalProducts : '...'}
              </span>
              <span className="text-[10px] sm:text-[11px] text-gray-500 mt-0.5 block truncate">
                Unique catalog SKUs
              </span>
            </div>
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 ml-2">
              <Package className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </div>

          {/* Card 2: Current Inventory Value */}
          <div className="bg-white rounded-xl p-3 sm:p-4 border border-gray-200 shadow-2xs flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider block truncate">
                Inventory Value
              </span>
              <span className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-gray-900 mt-0.5 sm:mt-1 block truncate">
                {data ? `${currencySymbol}${data.currentInventoryValue.toLocaleString()}` : '...'}
              </span>
              <span className="text-[10px] sm:text-[11px] text-gray-500 mt-0.5 block truncate">
                Total asset cost basis
              </span>
            </div>
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 ml-2">
              <DollarSign className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </div>

          {/* Card 3: Today's Sales */}
          <div className="bg-white rounded-xl p-3 sm:p-4 border border-gray-200 shadow-2xs flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider block truncate">
                Today's Sales
              </span>
              <span className="text-lg sm:text-2xl font-bold font-mono tabular-nums text-gray-900 mt-0.5 sm:mt-1 block truncate">
                {data ? `${currencySymbol}${data.todaySalesRevenue.toLocaleString()}` : '...'}
              </span>
              <span className="text-[10px] sm:text-[11px] text-emerald-700 font-medium mt-0.5 block truncate">
                {data ? `${data.todaySalesCount} sales recorded` : '...'}
              </span>
            </div>
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 ml-2">
              <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </div>

          {/* Card 4: Low-Stock Products */}
          <div 
            onClick={() => {
              setActiveTab('products');
              setFilterLowStockOnly(!filterLowStockOnly);
            }}
            className={`rounded-xl p-3 sm:p-4 border shadow-2xs flex items-center justify-between cursor-pointer transition-all ${
              data && data.lowStockCount > 0 
                ? 'bg-amber-50/80 border-amber-300 hover:bg-amber-100/70 active:bg-amber-100' 
                : 'bg-white border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="min-w-0 flex-1">
              <span className="text-[10px] sm:text-xs font-semibold text-gray-500 uppercase tracking-wider block truncate">
                Low-Stock Products
              </span>
              <span className={`text-lg sm:text-2xl font-bold font-mono tabular-nums mt-0.5 sm:mt-1 block ${data && data.lowStockCount > 0 ? 'text-amber-800' : 'text-gray-900'}`}>
                {data ? data.lowStockCount : '...'}
              </span>
              <span className="text-[10px] sm:text-[11px] text-amber-700 font-medium mt-0.5 block truncate">
                {data && data.lowStockCount > 0 ? 'Action: Restock' : 'All items well-stocked'}
              </span>
            </div>
            <div className={`w-9 h-9 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center shrink-0 ml-2 ${data && data.lowStockCount > 0 ? 'bg-amber-200 text-amber-900' : 'bg-gray-100 text-gray-600'}`}>
              <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </div>
        </div>

        {/* Dashboard Tabs & Navigation */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-2xs overflow-hidden">
          <div className="border-b border-gray-200 px-3 sm:px-4 pt-3 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gray-50/60">
            {/* Scrollable Tabs row on mobile */}
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none touch-pan-x pb-1 md:pb-0">
              <button
                onClick={() => setActiveTab('products')}
                className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 whitespace-nowrap min-h-[38px] ${
                  activeTab === 'products'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <Package className="w-4 h-4 shrink-0" />
                <span>Products & Stock ({products.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('sales')}
                className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 whitespace-nowrap min-h-[38px] ${
                  activeTab === 'sales'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <ShoppingBag className="w-4 h-4 shrink-0" />
                <span>Sales History ({sales.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('transactions')}
                className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 whitespace-nowrap min-h-[38px] ${
                  activeTab === 'transactions'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <Layers className="w-4 h-4 shrink-0" />
                <span>Stock Moves ({transactions.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('audit')}
                className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 whitespace-nowrap min-h-[38px] ${
                  activeTab === 'audit'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Audit Trail ({auditLogs.length})</span>
              </button>
            </div>

            {/* Product tab search and mobile view toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
              {activeTab === 'products' && (
                <div className="flex items-center gap-2 flex-1 sm:flex-initial">
                  <div className="relative flex-1 sm:flex-initial">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search product or SKU..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-600 w-full sm:w-52"
                    />
                  </div>
                  <button
                    onClick={() => setFilterLowStockOnly(!filterLowStockOnly)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors whitespace-nowrap min-h-[34px] ${
                      filterLowStockOnly
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    ⚠️ Low Stock
                  </button>
                </div>
              )}

              {/* Mobile Card / Table toggle button (visible on mobile screens) */}
              <div className="flex items-center bg-gray-200/80 p-0.5 rounded-lg md:hidden ml-auto">
                <button
                  onClick={() => setMobileDisplayMode('cards')}
                  className={`p-1.5 rounded-md text-xs flex items-center gap-1 ${
                    mobileDisplayMode === 'cards'
                      ? 'bg-white text-emerald-800 font-semibold shadow-2xs'
                      : 'text-gray-600'
                  }`}
                  title="Card View (optimized for mobile)"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span className="text-[11px]">Cards</span>
                </button>
                <button
                  onClick={() => setMobileDisplayMode('table')}
                  className={`p-1.5 rounded-md text-xs flex items-center gap-1 ${
                    mobileDisplayMode === 'table'
                      ? 'bg-white text-emerald-800 font-semibold shadow-2xs'
                      : 'text-gray-600'
                  }`}
                  title="Table View"
                >
                  <TableIcon className="w-3.5 h-3.5" />
                  <span className="text-[11px]">Table</span>
                </button>
              </div>
            </div>
          </div>

          {/* TAB 1: PRODUCTS VIEW */}
          {activeTab === 'products' && (
            <div>
              {/* MOBILE CARD VIEW FOR PRODUCTS */}
              <div className={`${mobileDisplayMode === 'cards' ? 'block md:hidden' : 'hidden'} p-3 space-y-3`}>
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-xs">
                    No products found matching your search.
                  </div>
                ) : (
                  filteredProducts.map((product) => {
                    const isLowStock = product.currentStock <= (product.minStockLevel || 0);
                    const val = product.currentStock * product.costPrice;

                    return (
                      <div 
                        key={product.id} 
                        className="bg-white rounded-xl p-3.5 border border-gray-200 shadow-2xs space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-semibold text-sm text-gray-900 block leading-tight">
                              {product.name}
                            </span>
                            <span className="font-mono text-[10px] text-gray-400 block mt-0.5">
                              SKU: {product.sku}
                            </span>
                          </div>

                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1 ${
                            isLowStock 
                              ? 'bg-amber-100 text-amber-800 border border-amber-300' 
                              : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {isLowStock ? (
                              <>
                                <AlertTriangle className="w-2.5 h-2.5" />
                                Low ({product.currentStock}/{product.minStockLevel || 0})
                              </>
                            ) : (
                              'In Stock'
                            )}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2 rounded-lg text-[11px]">
                          <div>
                            <span className="text-gray-500 block text-[10px]">Stock</span>
                            <span className="font-bold font-mono text-gray-900 text-xs">
                              {product.currentStock} {product.unit}(s)
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 block text-[10px]">Price</span>
                            <span className="font-bold font-mono text-emerald-800 text-xs">
                              {currencySymbol}{product.sellingPrice.toLocaleString()}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 block text-[10px]">Value</span>
                            <span className="font-mono text-gray-700 text-xs">
                              {currencySymbol}{val.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] text-gray-400">
                            Cost: {currencySymbol}{product.costPrice.toLocaleString()}
                          </span>
                          <button
                            onClick={() => onOpenAddStock(product)}
                            className="px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-200 rounded-lg transition-colors min-h-[38px] flex items-center gap-1"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Stock</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* DESKTOP TABLE VIEW FOR PRODUCTS */}
              <div className={`${mobileDisplayMode === 'cards' ? 'hidden md:block' : 'block'} overflow-x-auto`}>
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100/80 text-gray-600 uppercase font-semibold border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3">Product / ID</th>
                      <th className="px-4 py-3">SKU</th>
                      <th className="px-4 py-3">Current Stock</th>
                      <th className="px-4 py-3">Cost Price</th>
                      <th className="px-4 py-3">Selling Price</th>
                      <th className="px-4 py-3">Inventory Value</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 font-mono tabular-nums">
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-gray-500 font-sans">
                          No products found matching your search.
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map((product) => {
                        const isLowStock = product.currentStock <= (product.minStockLevel || 0);
                        const val = product.currentStock * product.costPrice;

                        return (
                          <tr key={product.id} className="hover:bg-gray-50/80 transition-colors font-sans">
                            <td className="px-4 py-3">
                              <span className="font-semibold text-gray-900 block">{product.name}</span>
                              <span className="font-mono text-[10px] text-gray-400">ID: {product.id}</span>
                            </td>
                            <td className="px-4 py-3 font-mono text-gray-600">
                              {product.sku}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 font-mono">
                                <span className="font-bold text-sm text-gray-900">
                                  {product.currentStock} {product.unit}(s)
                                </span>
                                {isLowStock && (
                                  <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded flex items-center gap-0.5 font-sans">
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                    Min: {product.minStockLevel}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-700 font-mono">
                              {currencySymbol}{product.costPrice.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 font-medium text-emerald-800 font-mono">
                              {currencySymbol}{product.sellingPrice.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-gray-900 font-semibold font-mono">
                              {currencySymbol}{val.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right font-sans">
                              <button
                                onClick={() => onOpenAddStock(product)}
                                className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors shadow-2xs min-h-[32px]"
                              >
                                + Add Stock
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: SALES HISTORY */}
          {activeTab === 'sales' && (
            <div>
              {/* MOBILE CARD VIEW FOR SALES */}
              <div className={`${mobileDisplayMode === 'cards' ? 'block md:hidden' : 'hidden'} p-3 space-y-3`}>
                {sales.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-xs">
                    No sales recorded yet. Message the WhatsApp assistant: "I sold 5 cartons of Indomie for 42500" to record one!
                  </div>
                ) : (
                  sales.map((s) => (
                    <div key={s.id} className="bg-white rounded-xl p-3.5 border border-gray-200 shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-xs text-emerald-800">
                          {s.invoiceNumber}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {new Date(s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-gray-900">
                          {s.customerName || 'Walk-in Customer'}
                        </span>
                        <span className="font-mono font-bold text-sm text-emerald-700">
                          {currencySymbol}{(s.totalAmount || s.total || 0).toLocaleString()}
                        </span>
                      </div>

                      <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded-lg">
                        {(s.items || []).map((it, idx) => (
                          <div key={idx} className="flex justify-between py-0.5">
                            <span>{it.quantity}x {it.productName || 'Product'}</span>
                            <span className="font-mono text-gray-500">{currencySymbol}{(it.subtotal || 0).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                          {s.paymentStatus} • {s.paymentMethod}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          Salesperson: {(s as any).salespersonName || (s as any).salesperson || 'Store Admin'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* DESKTOP TABLE VIEW FOR SALES */}
              <div className={`${mobileDisplayMode === 'cards' ? 'hidden md:block' : 'block'} overflow-x-auto`}>
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100/80 text-gray-600 uppercase font-semibold border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3">Invoice #</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Items Sold</th>
                      <th className="px-4 py-3">Total Amount</th>
                      <th className="px-4 py-3">Method</th>
                      <th className="px-4 py-3">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sales.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-gray-500">
                          No sales recorded yet. Tell the WhatsApp assistant: "I sold 5 cartons of Indomie for 42500" to record one!
                        </td>
                      </tr>
                    ) : (
                      sales.map((s) => (
                        <tr key={s.id} className="hover:bg-gray-50/80 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold text-emerald-800">
                            {s.invoiceNumber}
                          </td>
                          <td className="px-4 py-3 text-gray-800 font-medium">
                            {s.customerName || 'Walk-in Customer'}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {(s.items || []).map((it, idx) => (
                              <span key={idx} className="block">
                                {it.quantity}x {it.productName || 'Product'} ({currencySymbol}{(it.subtotal || 0).toLocaleString()})
                              </span>
                            ))}
                          </td>
                          <td className="px-4 py-3 font-bold text-sm text-gray-900 font-mono tabular-nums">
                            {currencySymbol}{(s.totalAmount || s.total || 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                              {s.paymentStatus} • {s.paymentMethod}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-[11px]">
                            {new Date(s.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: INVENTORY TRANSACTIONS */}
          {activeTab === 'transactions' && (
            <div>
              {/* MOBILE CARD VIEW FOR TRANSACTIONS */}
              <div className={`${mobileDisplayMode === 'cards' ? 'block md:hidden' : 'hidden'} p-3 space-y-3`}>
                {transactions.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-xs">
                    No transactions found.
                  </div>
                ) : (
                  transactions.map((tx) => {
                    const isPositive = (tx.quantityChange || 0) > 0;
                    return (
                      <div key={tx.id} className="bg-white rounded-xl p-3.5 border border-gray-200 shadow-2xs space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            tx.type === 'STOCK_IN' || tx.type === 'INITIAL_STOCK'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}>
                            {tx.type}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm text-gray-900">
                            {tx.productName}
                          </span>
                          <span className={`font-mono font-bold flex items-center gap-0.5 text-sm ${
                            isPositive ? 'text-emerald-700' : 'text-red-700'
                          }`}>
                            {isPositive ? (
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            )}
                            {isPositive ? `+${tx.quantityChange}` : tx.quantityChange}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs bg-gray-50 p-2 rounded-lg">
                          <span className="text-gray-500">Resulting Stock:</span>
                          <span className="font-bold font-mono text-gray-900">{tx.resultingStock}</span>
                        </div>

                        {tx.notes && (
                          <p className="text-[11px] text-gray-500 truncate">
                            {tx.notes}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* DESKTOP TABLE VIEW FOR TRANSACTIONS */}
              <div className={`${mobileDisplayMode === 'cards' ? 'hidden md:block' : 'block'} overflow-x-auto`}>
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100/80 text-gray-600 uppercase font-semibold border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3">Tx ID</th>
                      <th className="px-4 py-3">Product Name</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Change</th>
                      <th className="px-4 py-3">Resulting Stock</th>
                      <th className="px-4 py-3">Notes & Reference</th>
                      <th className="px-4 py-3">Date / Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 font-mono tabular-nums">
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-gray-500 font-sans">
                          No transactions found.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => {
                        const isPositive = (tx.quantityChange || 0) > 0;
                        return (
                          <tr key={tx.id} className="hover:bg-gray-50/80 transition-colors font-sans">
                            <td className="px-4 py-3 font-mono text-gray-500 text-[11px]">
                              {tx.id}
                            </td>
                            <td className="px-4 py-3 font-semibold text-gray-900">
                              {tx.productName}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                tx.type === 'STOCK_IN' || tx.type === 'INITIAL_STOCK'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-purple-100 text-purple-800'
                              }`}>
                                {tx.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono">
                              <span className={`font-bold flex items-center gap-0.5 ${
                                isPositive ? 'text-emerald-700' : 'text-red-700'
                              }`}>
                                {isPositive ? (
                                  <ArrowDownLeft className="w-3.5 h-3.5" />
                                ) : (
                                  <ArrowUpRight className="w-3.5 h-3.5" />
                                )}
                                {isPositive ? `+${tx.quantityChange}` : tx.quantityChange}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold text-gray-900 font-mono">
                              {tx.resultingStock}
                            </td>
                            <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={tx.notes}>
                              <span className="block truncate">{tx.notes}</span>
                              <span className="font-mono text-[10px] text-gray-400">Ref: {tx.referenceId}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-[11px]">
                              {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: AUDIT TRAIL */}
          {activeTab === 'audit' && (
            <div>
              <div className="p-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                <span className="leading-tight">
                  <b>Audit Invariant Guaranteed:</b> Every stock and sales mutation creates an immutable audit record with actor, action, and states.
                </span>
              </div>

              {/* MOBILE CARD VIEW FOR AUDIT */}
              <div className={`${mobileDisplayMode === 'cards' ? 'block md:hidden' : 'hidden'} p-3 space-y-3`}>
                {auditLogs.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-xs">
                    No audit logs yet.
                  </div>
                ) : (
                  auditLogs.map((log) => (
                    <div key={log.id} className="bg-white rounded-xl p-3.5 border border-gray-200 shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded">
                          {log.action}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {new Date(log.createdAt || log.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-800 font-medium">Actor: {log.actor}</span>
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-800 rounded">
                          {log.entityType}
                        </span>
                      </div>

                      <div className="text-[10px] font-mono text-gray-500 bg-gray-50 p-2 rounded-lg space-y-1">
                        <div>Entity: {log.entityId}</div>
                        {log.beforeState && (
                          <div className="text-red-600 truncate">
                            Before: {JSON.stringify(log.beforeState)}
                          </div>
                        )}
                        {log.afterState && (
                          <div className="text-emerald-700 truncate">
                            After: {JSON.stringify(log.afterState)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* DESKTOP TABLE VIEW FOR AUDIT */}
              <div className={`${mobileDisplayMode === 'cards' ? 'hidden md:block' : 'block'} overflow-x-auto`}>
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100/80 text-gray-600 uppercase font-semibold border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3">Audit ID</th>
                      <th className="px-4 py-3">Actor</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Entity</th>
                      <th className="px-4 py-3">Entity ID</th>
                      <th className="px-4 py-3">Audit Details / State</th>
                      <th className="px-4 py-3">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-gray-500">
                          No audit logs yet.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-50/80 transition-colors">
                          <td className="px-4 py-3 font-mono text-[10px] text-gray-400">
                            {log.id}
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-800">
                            {log.actor}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-[11px] font-bold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">
                              {log.action}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-800 rounded">
                              {log.entityType}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-500 text-[10px]">
                            {log.entityId}
                          </td>
                          <td className="px-4 py-3 text-gray-600 max-w-sm">
                            {log.beforeState && (
                              <span className="text-[10px] text-red-600 block truncate">
                                Before: {JSON.stringify(log.beforeState)}
                              </span>
                            )}
                            {log.afterState && (
                              <span className="text-[10px] text-emerald-700 block truncate">
                                After: {JSON.stringify(log.afterState)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-[11px]">
                            {new Date(log.createdAt || log.timestamp || Date.now()).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

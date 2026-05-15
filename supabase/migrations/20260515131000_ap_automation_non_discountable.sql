-- AP Automation pricing is set by Sage, not the rep — these SKUs should always
-- bypass rep discounting (and bypass any global discount applied to the quote).

UPDATE products
  SET non_discountable = true,
      excluded_from_global_discount = true,
      max_rep_discount_pct = 0
  WHERE sku LIKE 'IFM-AP-AUTO%';

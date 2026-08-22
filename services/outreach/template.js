const VARS = ["admin_name", "group_name", "city", "office_name"];

export const DEFAULT_ADMIN_TEMPLATE =
  "سلام {{admin_name}}، وقت بخیر. من از مجموعه {{office_name}} هستم. در زمینه فایل‌های ملکی منطقه {{city}} فعالیت داریم. در صورت اجازه شما، مایل هستیم بعضی فایل‌های مرتبط و محدود را در گروه {{group_name}} منتشر کنیم. اگر موافق باشید، ممنون می‌شوم اطلاع دهید.";

export function renderTemplate(template, vars = {}) {
  let out = String(template || "");
  for (const key of VARS) {
    const value = vars[key] == null ? "" : String(vars[key]);
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

export function templateVarsFromAdmin(admin, { officeName } = {}) {
  return {
    admin_name: admin.display_name || admin.displayName || "مدیر گروه",
    group_name: admin.group_name || admin.groupName || "",
    city: admin.city || "سایر",
    office_name: officeName || "املاک فرتاک"
  };
}

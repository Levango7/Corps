/** 通讯录模块共享类型 */

/** 联系人列表项（GET /contacts 列表返回的 select 子集） */
export interface ContactItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
  avatar: string | null;
  groupId: string | null;
  updatedAt: string;
}

/** 联系人详情（GET /contacts/{cid} 返回，含 group 和 creator 关联） */
export interface ContactDetail extends ContactItem {
  notes: string | null;
  createdAt: string;
  group: { id: string; name: string } | null;
  creator: { id: string; name: string | null; email: string } | null;
}

/** 联系人分组（GET /contact-groups 返回，含 _count.contacts） */
export interface ContactGroupItem {
  id: string;
  name: string;
  _count: { contacts: number };
}
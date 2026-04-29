"""Authorization rules for page-related actions.

The matrix:

                    | reader | contributor | editor (in-cat) | editor (out)  | admin |
--------------------+--------+-------------+-----------------+---------------+-------+
read published     |   ✓    |     ✓       |       ✓         |      ✓        |   ✓   |
create draft        |        |     ✓       |       ✓         |      ✓        |   ✓   |
edit own draft      |        |     ✓       |       ✓         |      ✓        |   ✓   |
propose             |        |     ✓       |       ✓         |      ✓        |   ✓   |
review              |        |             |       ✓ (open/  |               |   ✓   |
                    |        |             |        stable)  |               |       |
publish locked page |        |             |                 |               |   ✓   |
lock/unlock page    |        |             |                 |               |   ✓   |
manage roles        |        |             |                 |               |   ✓   |

"open" stability auto-publishes on submit. "stable" requires editor review.
"locked" requires admin review.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CategoryEditor, Page, PageStability, Role, User


async def is_editor_for_page(session: AsyncSession, user: User, page: Page) -> bool:
    if user.role == Role.admin:
        return True
    if user.role != Role.editor:
        return False
    if page.category_id is None:
        # Editor without category scope can review uncategorized pages
        return True
    found = (await session.execute(
        select(CategoryEditor).where(
            CategoryEditor.user_id == user.id,
            CategoryEditor.category_id == page.category_id,
        )
    )).scalar_one_or_none()
    return found is not None


async def can_review(session: AsyncSession, user: User, page: Page) -> bool:
    """Can this user accept/reject a proposed revision on this page?"""
    if user.role == Role.admin:
        return True
    if page.stability == PageStability.locked:
        return False  # admin only
    return await is_editor_for_page(session, user, page)


async def can_propose(user: User) -> bool:
    return user.role in (Role.contributor, Role.editor, Role.admin)


async def can_lock(user: User) -> bool:
    return user.role == Role.admin

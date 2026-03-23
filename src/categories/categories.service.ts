import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  /**
   * CREATE_CATEGORY
   * Generates hierarchical slugs to prevent collisions.
   */
  async create(dto: CreateCategoryDto) {
    let slug = dto.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');

    // If a parent exists, prefix the slug (e.g., 'fashion-men-shirts')
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
        select: { slug: true }
      });
      if (!parent) throw new NotFoundException('PARENT_NOT_FOUND');
      slug = `${parent.slug}-${slug}`;
    }

    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name,
          slug: slug,
          parentId: dto.parentId || null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('SLUG_ALREADY_EXISTS: Choose a more specific category name.');
      }
      throw error;
    }
  }

  /**
   * FIND_ALL_HIERARCHICAL
   * Returns a tree structure optimized for the recursive sidebar.
   */
  async findAll() {
    return this.prisma.category.findMany({
      where: { parentId: null }, // Fetch root nodes
      orderBy: { name: 'asc' },
      include: {
        children: {
          orderBy: { name: 'asc' },
          include: {
            children: {
              orderBy: { name: 'asc' },
              include: {
                children: true // Support for deeper nesting if needed
              }
            }
          }
        }
      }
    });
  }

  /**
   * FIND_BY_SLUG
   * Useful for the Shop Page breadcrumbs.
   */
  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: { 
        parent: true,
        children: true 
      }
    });

    if (!category) throw new NotFoundException('CATEGORY_NOT_FOUND');
    return category;
  }

  /**
   * REMOVE_CATEGORY
   * Prevents deleting a parent if it has children (Safe Delete).
   */
  async remove(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { children: true } } }
    });

    if (!category) throw new NotFoundException('CATEGORY_NOT_FOUND');
    if (category._count.children > 0) {
      throw new BadRequestException('CANNOT_DELETE_PARENT: Reassign or delete children first.');
    }

    return this.prisma.category.delete({ where: { id } });
  }
}
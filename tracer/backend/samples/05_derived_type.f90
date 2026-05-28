! Construct 05: Derived Type Operations
! Demonstrates: Struct field access lowering, component offset calculation,
!               fir.field_index, fir.coordinate_of, fir.extract_value
module geometry_types
  implicit none

  type :: Vec3
    real :: x, y, z
  end type Vec3

  type :: Particle
    type(Vec3) :: position
    type(Vec3) :: velocity
    real       :: mass
    integer    :: id
  end type Particle

contains

  subroutine advance_particle(p, dt)
    type(Particle), intent(inout) :: p
    real,           intent(in)    :: dt

    ! Nested derived type field access — triggers fir.coordinate_of chains
    p%position%x = p%position%x + p%velocity%x * dt
    p%position%y = p%position%y + p%velocity%y * dt
    p%position%z = p%position%z + p%velocity%z * dt

  end subroutine advance_particle

  function dot_product_vec3(a, b) result(d)
    type(Vec3), intent(in) :: a, b
    real :: d
    d = a%x*b%x + a%y*b%y + a%z*b%z
  end function dot_product_vec3

end module geometry_types

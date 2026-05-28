! Construct 10: Generic Interface Resolution
! Demonstrates: Overload resolution at semantics phase, procedure pointer
!               table, monomorphic call sites in FIR, name mangling
module generic_math
  implicit none

  ! Generic interface — resolved at compile time (not runtime)
  interface add
    module procedure add_int
    module procedure add_real
    module procedure add_complex
  end interface add

  interface norm
    module procedure norm_1d
    module procedure norm_2d
  end interface norm

contains

  pure function add_int(a, b) result(r)
    integer, intent(in) :: a, b
    integer :: r
    r = a + b
  end function add_int

  pure function add_real(a, b) result(r)
    real, intent(in) :: a, b
    real :: r
    r = a + b
  end function add_real

  pure function add_complex(a, b) result(r)
    complex, intent(in) :: a, b
    complex :: r
    r = a + b
  end function add_complex

  ! norm variants — different rank argument dispatching
  pure function norm_1d(v, n) result(nv)
    integer, intent(in) :: n
    real, intent(in) :: v(n)
    real :: nv
    nv = SQRT(SUM(v*v))
  end function norm_1d

  pure function norm_2d(m, n, k) result(nm)
    integer, intent(in) :: n, k
    real, intent(in) :: m(n,k)
    real :: nm
    nm = SQRT(SUM(m*m))
  end function norm_2d

  subroutine demo_dispatch()
    integer :: i_result
    real    :: r_result
    complex :: c_result
    real    :: v(3) = [1.0, 2.0, 3.0]

    ! Each call resolves to a specific monomorphic procedure in FIR
    i_result = add(10, 20)          ! → add_int  → _QMgeneric_mathPadd_int
    r_result = add(1.5, 2.5)        ! → add_real → _QMgeneric_mathPadd_real
    c_result = add((1.0,0.0),(0.0,1.0))  ! → add_complex
    r_result = norm(v, 3)           ! → norm_1d

    print *, i_result, r_result, c_result
  end subroutine demo_dispatch

end module generic_math
